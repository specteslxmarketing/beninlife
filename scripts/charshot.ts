// Quick character look-dev: creator view close-ups (realistic MakeHuman bodies on Medium/High).
import { launch, player, ev, shot, tag } from './e2e-lib.js';
const browser = await launch();
const P = await player(browser, `Dev_${tag}`, { quality: process.env.Q ?? 'medium', viewport: process.env.WIDE ? { width: 1280, height: 720 } : { width: 900, height: 700 } });
P.page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 300)); });
await P.page.waitForSelector('#creator:not(.hidden)');
await ev(P.page, `(() => { const g = window.__beninlife; g.creatorView.spin = 0; document.querySelector('#creator').style.opacity = '0'; })()`);
const list = (process.argv[2] ?? 'male:casual:2:1:2.4:1.0:0.3').split(',');
for (const [i, spec] of list.entries()) {
  const [body, style, skin, outfit, dist, y, yaw, mode] = spec.split(':');
  await ev(P.page, `(() => { const g = window.__beninlife; g.player.setAppearance({ body: '${body}', skin: ${skin}, outfit: ${outfit} }); g.player.setOpts({ style: '${style}', crown: ${style === 'white_suit'} }); g.player.showTag(false); g.creatorView.dist = ${dist}; g.creatorView.y = ${y}; g.controls.camYaw = g.rot + ${yaw}; const pl = g.player; pl.pose = '${mode === 'sit' ? 'sit' : 'stand'}'; if (!pl.__orig) pl.__orig = pl.animate; pl.animate = (dt) => pl.__orig.call(pl, dt, ${mode === 'walk' ? 2.2 : 0}); })()`);
  await P.page.waitForTimeout(2500); await shot(P.page, process.env.OUT ? `${process.env.OUT}${i}.png` : `../_dev_${i}.png`);
}
await browser.close();
