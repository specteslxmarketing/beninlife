// BEST 𝕏 / BENINLIFE crown emblem (supplied by the project owner). Preloaded so canvas textures can draw it.
export const CROWN_URL = '/brand/crown.jpg';          // full emblem on black with ring
export const CROWN_GOLD_URL = '/brand/crown_gold.png'; // gold crown only, transparent background
export let crownGold: HTMLImageElement | null = null;
export let crownFull: HTMLImageElement | null = null;

function load(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}
export async function preloadBrand(): Promise<void> {
  [crownGold, crownFull] = await Promise.all([load(CROWN_GOLD_URL), load(CROWN_URL)]);
}
/** Draw the gold crown into a box (keeps aspect ratio). */
export function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (!crownGold) return;
  const s = Math.min(w / crownGold.width, h / crownGold.height);
  const dw = crownGold.width * s, dh = crownGold.height * s;
  ctx.drawImage(crownGold, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
