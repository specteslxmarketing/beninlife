// Shared helpers for phase-2 headless e2e runs (Playwright + system Chrome, software GL).
import fs from 'node:fs';
import { chromium, type Page, type BrowserContext, type Browser } from 'playwright';

export const base = process.env.BASE ?? 'http://localhost:3000';
export const OUT = 'screenshots/phase2';
export const tag = Math.random().toString(36).slice(2, 6);
export const results: string[] = [];
/** every browser console error / uncaught exception / unhandled rejection seen in any page (fails the run) */
export const consoleErrors: string[] = [];
/** known-benign console noise (documented): none by default; scripts may push RegExps */
export const allowConsole: RegExp[] = [];
export const log = (s: string) => { console.log(s); results.push(s); };
const autopilot = fs.existsSync('scripts/autopilot.js') ? fs.readFileSync('scripts/autopilot.js', 'utf8') : '';

export async function launch(): Promise<Browser> {
  fs.mkdirSync(OUT, { recursive: true });
  return chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
}

export interface P { ctx: BrowserContext; page: Page; name: string }
const pages: Page[] = [];
/** Software GL (swiftshader) is shared by every test page, so pages draw only while being screenshotted (game logic,
 *  physics, animation and networking keep running every frame). Set E2E_RENDER=1 to draw continuously. */
const ALWAYS = process.env.E2E_RENDER === '1';
const setPaused = (q: Page, v: boolean) => q.evaluate(`window.__beninlife && (window.__beninlife.renderPaused = ${v})`).catch(() => undefined);
export async function pauseAll(): Promise<void> { if (!ALWAYS) for (const q of pages) if (!q.isClosed()) await setPaused(q, true); }
export async function player(browser: Browser, name: string, opts: { quality?: string; viewport?: { width: number; height: number }; mobile?: boolean; password?: string; login?: boolean; query?: string; ambient?: boolean } = {}): Promise<P> {
  const mobile = !!opts.mobile;
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 720 }, isMobile: mobile, hasTouch: mobile, permissions: ['microphone'],
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' : undefined });
  await ctx.addInitScript(`localStorage.setItem('bl_quality', '${opts.quality ?? 'low'}'); localStorage.setItem('bl_ambient', '${opts.ambient === false ? '0' : '1'}');`);
  if (autopilot) await ctx.addInitScript(autopilot);
  await ctx.addInitScript(`window.addEventListener('unhandledrejection', (e) => console.error('[unhandledrejection]', (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));
    document.addEventListener('DOMContentLoaded', () => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) console.log('[toast] ' + n.textContent); })
      .observe(document.body, { childList: true, subtree: true }));`);
  const password = opts.password ?? 'password-' + tag;
  if (opts.login) await ctx.request.post(`${base}/api/login`, { data: { username: name, password } });
  else await ctx.request.post(`${base}/api/register`, { data: { username: name, password, ageConfirmed: true } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { consoleErrors.push(`[pageerror ${name}] ${e.message}`); console.log(`[pageerror ${name}]`, e.message); });
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[toast]')) console.log(`  ${name} ${t}`);
    if (m.type() === 'error' && !allowConsole.some((r) => r.test(t))) { const loc = m.location(); consoleErrors.push(`[console ${name}] ${t}${loc?.url ? ` (${loc.url.split('/').pop()}:${loc.lineNumber})` : ''}`); console.log(`[console.error ${name}]`, t.slice(0, 300)); }
  });
  await pauseAll();
  await page.goto(`${base}/?capture=1&${opts.query ?? 'hour=10'}`);
  await page.waitForFunction('!!window.__beninlife', null, { timeout: 240000 });
  pages.push(page);
  await pauseAll();
  return { ctx, page, name };
}
/** Get through the creator (new accounts) and the intro (if shown) into play. */
export async function enter(p: Page, skin = 0, outfit = 1, body = 'male'): Promise<void> {
  await p.waitForFunction("!document.querySelector('#creator').classList.contains('hidden') || !document.querySelector('#intro').classList.contains('hidden') || !document.querySelector('#hud').classList.contains('hidden')", null, { timeout: 60000 });
  if (await p.isVisible('#creator')) {
    await p.click(`#cr-body button[data-b="${body}"]`); await p.click(`#cr-skin button[data-i="${skin}"]`);
    if (await p.isVisible(`#cr-outfit button[data-i="${outfit}"]`)) await p.click(`#cr-outfit button[data-i="${outfit}"]`);
    await p.click('#cr-save');
  }
  await p.waitForFunction("!document.querySelector('#intro').classList.contains('hidden') || !document.querySelector('#hud').classList.contains('hidden')", null, { timeout: 60000 });
  if (await p.isVisible('#intro-skip')) await p.click('#intro-skip');
  await p.waitForSelector('#hud:not(.hidden)', { timeout: 120000 });
}
export const ev = <T = unknown>(p: Page, js: string) => p.evaluate(js) as Promise<T>;
export async function shot(p: Page, name: string): Promise<void> { await draw(p); await p.screenshot({ path: `${OUT}/${name}`, timeout: 180000 }); if (!ALWAYS) await setPaused(p, true); log(`  saved ${OUT}/${name}`); }
/** draw this page for a moment so the screenshot is current */
async function draw(p: Page): Promise<void> { await setPaused(p, false); await p.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))').catch(() => undefined); }
/** draw a page once (first draw compiles every shader — slow on software GL), then pause it again */
export async function warm(p: Page): Promise<void> { await draw(p); if (!ALWAYS) await setPaused(p, true); }
export function check(label: string, ok: boolean, extra = ''): boolean { log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`); return ok; }
export async function phone(p: Page, app: string): Promise<void> {
  if (!(await p.isVisible('#phone'))) { await p.click('#btn-phone'); }
  await p.click('#phone-home'); await p.click(`#phone-screen [data-nav="${app}"]`); await p.waitForTimeout(500);
}
export function adminPassword(): string {
  const t = fs.readFileSync('ADMIN_CREDENTIALS.txt', 'utf8');
  const m = t.match(/password:\s*(\S+)/i);
  if (!m) throw new Error('admin password not found');
  return m[1];
}
export function saveResults(file: string): void {
  check('CONSOLE: no browser console errors, uncaught exceptions or unhandled rejections', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | ').slice(0, 900));
  fs.writeFileSync(`${OUT}/${file}`, results.join('\n') + '\n');
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  if (fails) { console.log(`${fails} check(s) FAILED`); process.exitCode = 1; }
}

/** BEST 𝕏 admin tools over a bare Socket.IO connection (no browser): teleport/summon players, fund test accounts.
 *  Lets e2e runs spend from separate test accounts instead of the owner's wallet. */
export async function adminSocket(): Promise<{ emit: <T = { ok: boolean; error?: string }>(ev: string, p?: unknown) => Promise<T>; close: () => void }> {
  const { io } = await import('socket.io-client');
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bestx', password: adminPassword() }) });
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const s = io(base, { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise<void>((res, rej) => { s.once('init', () => res()); s.once('connect_error', rej); });
  return { emit: (ev, p = {}) => new Promise((res) => s.emit(ev, p, res)), close: () => s.close() };
}
