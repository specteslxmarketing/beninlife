// Close-up screenshots of the procedural characters (creator view) incl. BEST 𝕏 white suit + crown pendant.
import { launch, player, ev, shot, check, tag, adminPassword, saveResults } from './e2e-lib.js';
const browser = await launch();
const P = await player(browser, `Look_${tag}`, { quality: 'high', viewport: { width: 1000, height: 760 } });
await P.page.waitForSelector('#creator:not(.hidden)');
await ev(P.page, `(() => { const g = window.__beninlife; g.creatorView.spin = 0; document.querySelector('#creator').style.opacity = '0.0'; })()`);
const views: [string, string, number, number, number, number][] = [
  // file, body, skin, outfit, dist, lookY
  ['char_01_male_full.png', 'male', 0, 1, 2.6, 1.0],
  ['char_02_male_face.png', 'male', 0, 1, 0.75, 1.68],
  ['char_03_female_full.png', 'female', 3, 4, 2.6, 0.98],
  ['char_04_female_face.png', 'female', 3, 4, 0.72, 1.6],
  ['char_05_male_dark_side.png', 'male', 5, 6, 2.2, 1.1],
];
for (const [file, body, skin, outfit, dist, y] of views) {
  await P.page.click(`#cr-body button[data-b="${body}"]`); await P.page.click(`#cr-skin button[data-i="${skin}"]`); await P.page.click(`#cr-outfit button[data-i="${outfit}"]`);
  await ev(P.page, `(() => { const g = window.__beninlife; g.creatorView.dist = ${dist}; g.creatorView.y = ${y}; g.controls.camYaw = g.rot + ${file.includes('side') ? 0.9 : 0.25}; })()`);
  await P.page.waitForTimeout(2500); await shot(P.page, file);
}
await P.ctx.close();
// BEST 𝕏
const A = await player(browser, 'bestx', { quality: 'high', viewport: { width: 1000, height: 760 }, login: true, password: adminPassword() });
await A.page.waitForSelector('#hud:not(.hidden), #intro:not(.hidden), #creator:not(.hidden)');
await ev(A.page, `(() => { const g = window.__beninlife; if (g.intro) g.skipIntro(); })()`);
await A.page.waitForTimeout(1500);
await ev(A.page, `(() => { const g = window.__beninlife; g.mode = 'creator'; g.creatorView.spin = 0; g.creatorView.dist = 2.4; g.creatorView.y = 1.05; g.controls.camYaw = g.rot + 0.3; document.querySelector('#hud').style.display = 'none'; document.querySelector('#creator').classList.add('hidden'); })()`);
await A.page.waitForTimeout(2500); await shot(A.page, 'char_06_bestx_white_suit_crown.png');
await ev(A.page, `(() => { const g = window.__beninlife; g.creatorView.dist = 0.95; g.creatorView.y = 1.5; })()`);
await A.page.waitForTimeout(2500); await shot(A.page, 'char_07_bestx_crown_pendant_closeup.png');
// outfit previews (client-side render of each Uyi Fashion House style on a male and a female body)
const styles = ['ankara', 'senator', 'agbada', 'black_suit', 'edo_coral'];
for (const [i, st] of styles.entries()) {
  const female = i % 2 === 1;
  await ev(A.page, `(() => { const g = window.__beninlife; g.player.setAppearance({ body: '${female ? 'female' : 'male'}', skin: ${i % 6}, outfit: 2 }); g.player.setOpts({ style: '${st}' }); g.creatorView.dist = 2.5; g.creatorView.y = 1.0; g.controls.camYaw = g.rot + 0.35; })()`);
  await A.page.waitForTimeout(2500); await shot(A.page, `char_${String(8 + i).padStart(2, '0')}_outfit_${st}.png`);
}
check('CHARACTERS: close-up screenshots captured', true);
saveResults('e2e_characters.txt');
await browser.close();
