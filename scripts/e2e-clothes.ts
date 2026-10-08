// E2E: clothing store end to end with a separate, admin-funded test shopper (BEST 𝕏's wallet is not spent):
// walk into Uyi Fashion House → browse → buy two outfits with real ₦ through the server → wear them → change clothes
// in the Wardrobe phone app → outfit survives a reload → another player sees it. Before/after screenshots.
import { launch, player, enter, ev, shot, check, log, saveResults, tag, phone, adminSocket } from './e2e-lib.js';
import { CLOTHES, CLOTHING_STORE } from '../shared/constants.js';

const Q = process.env.Q ?? 'high';
const browser = await launch();
const admin = await adminSocket();
const A = await player(browser, `Ivie_${tag}`, { quality: Q, ambient: false });
await enter(A.page, 2, 1, 'male');
const p = A.page; const G = 'window.__beninlife';
const id = await ev<number>(p, `${G}.me.id`);
const tp = async (x: number, z: number) => { const r = await admin.emit('admin:teleport', { id, x, z }); await p.waitForFunction(`Math.hypot(${G}.pos.x - ${x}, ${G}.pos.y - ${z}) < 2`, null, { timeout: 15000 }).catch(() => undefined); await p.waitForTimeout(800); return r.ok; };
const balance = () => ev<number>(p, `${G}.balance`);
const style = () => ev<string>(p, `${G}.style`);
const portrait = async (name: string) => {
  await ev(p, `(() => { document.querySelector('#phone').classList.add('hidden'); const g = ${G}; g.controls.enabled = true; g.camOverride = [g.pos.x + Math.sin(g.rot) * 2.6 + 0.8, 1.5, g.pos.y + Math.cos(g.rot) * 2.6, g.pos.x, 1.0, g.pos.y]; })()`);
  await p.waitForTimeout(2500); await shot(p, name);
};
check('CLOTHES: test shopper funded by the admin grant tool', (await admin.emit('admin:grant', { id, amount: 500_000 })).ok);
await p.waitForFunction(`${G}.balance >= 500000`, null, { timeout: 15000 }).catch(() => undefined);
check('CLOTHES: shopper at Uyi Fashion House', await tp(CLOTHING_STORE.door.x, CLOTHING_STORE.door.z + 1.2));
const startStyle = await style();
await portrait('clothes_00_before.png');
await ev(p, `${G}.camOverride = [${CLOTHING_STORE.door.x + 5}, 2.6, ${CLOTHING_STORE.door.z + 8}, ${CLOTHING_STORE.door.x}, 1.4, ${CLOTHING_STORE.door.z}]`);
await p.waitForTimeout(1500); await shot(p, 'clothes_01_store_front.png');
const acts = await ev<string[]>(p, `${G}.contextActions().map(a => a.id)`);
check('CLOTHES: "Browse clothes" offered at the shop entrance', acts.includes('shop:clothes'), acts.join(','));
await ev(p, `${G}.camOverride = null`);
await p.keyboard.press('f'); await p.waitForTimeout(2000);
check('CLOTHES: store opens in the phone with prices', await ev<boolean>(p, `!document.querySelector('#phone').classList.contains('hidden') && document.querySelector('#phone-screen').textContent.includes('${CLOTHING_STORE.name}')`));
await shot(p, 'clothes_02_store_menu.png');
const buy = ['ankara', 'agbada'];
for (const [i, cid] of buy.entries()) {
  const c = CLOTHES.find((x) => x.id === cid)!;
  await p.waitForSelector(`[data-buy="${cid}"]`, { timeout: 15000 });
  const before = await balance();
  await p.click(`[data-buy="${cid}"]`);
  await p.waitForFunction(`${G}.balance === ${before - c.price}`, null, { timeout: 15000 }).catch(() => undefined);
  check(`CLOTHES: bought ${c.name} — server debited ${c.price}`, before - (await balance()) === c.price, `${before} → ${await balance()}`);
  await p.waitForFunction(`${G}.style === '${cid}'`, null, { timeout: 10000 }).catch(() => undefined);
  check(`CLOTHES: now wearing ${c.name}`, (await style()) === cid);
  await portrait(`clothes_0${3 + i}_${cid}_after.png`);
  await ev(p, `${G}.camOverride = null`);
  await p.keyboard.press('f'); await p.waitForTimeout(1500);
}
// Wardrobe phone app: change back into the first purchase (owned clothes can be worn anywhere)
await ev(p, `document.querySelector('#phone').classList.add('hidden')`);
await tp(CLOTHING_STORE.door.x + 14, CLOTHING_STORE.door.z + 6); // away from the shop
await phone(p, 'wardrobe');
await p.waitForSelector(`[data-wear="${buy[0]}"]`, { timeout: 15000 }).catch(() => undefined);
await shot(p, 'clothes_05_wardrobe_app.png');
await p.click(`[data-wear="${buy[0]}"]`).catch(() => undefined);
await p.waitForFunction(`${G}.style === '${buy[0]}'`, null, { timeout: 10000 }).catch(() => undefined);
check('CLOTHES: Wardrobe app changes clothes away from the shop', (await style()) === buy[0], `${startStyle} → ${await style()}`);
await portrait('clothes_06_wardrobe_changed.png');
await ev(p, `${G}.camOverride = null`);
await p.reload(); await enter(p);
check('CLOTHES: outfit saved on the server (survives reload)', (await style()) === buy[0]);
// a second player sees it
const B = await player(browser, `Fan_${tag}`, { quality: 'low', ambient: false });
await enter(B.page);
const bId = await ev<number>(B.page, `${G}.me.id`);
const here = await ev<{ x: number; z: number }>(p, `({ x: ${G}.pos.x, z: ${G}.pos.y })`);
await admin.emit('admin:teleport', { id: bId, x: here.x + 2.5, z: here.z + 3 });
await B.page.waitForFunction(`[...${G}.remotes.values()].some(r => r.snap.id === ${id} || r.snap.name === 'Ivie_${tag}')`, null, { timeout: 20000 }).catch(() => undefined);
const seen = await ev<string | undefined>(B.page, `(() => { for (const r of ${G}.remotes.values()) if (r.snap.name === 'Ivie_${tag}') return r.snap.style; })()`);
check('CLOTHES: other players see the outfit (snapshot style)', seen === buy[0], String(seen));
log(`  start style ${startStyle}`);
admin.close();
saveResults('e2e_clothes.txt');
await browser.close();
