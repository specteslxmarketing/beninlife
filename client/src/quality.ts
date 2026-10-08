export type Quality = 'low' | 'medium' | 'high';

/** iPad incl. iPadOS 13+ Safari, which reports itself as "Macintosh" — told apart from a Mac by multi-touch */
export function isIPad(): boolean {
  const ua = navigator.userAgent;
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}
export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 1;
}

export function recommendedQuality(): Quality {
  const ua = navigator.userAgent;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  // iPads (A12+/M-series) handle Medium well; Safari hides deviceMemory, so decide on cores. The game also lowers
  // its render resolution on the fly if the frame rate drops (see Game.adaptResolution).
  if (isIPad()) return cores >= 4 ? 'medium' : 'low';
  const mobile = /Android|iPhone|iPod|Mobile/i.test(ua) || matchMedia('(pointer: coarse)').matches;
  if (mobile) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  if (cores <= 2) return 'low';
  return 'medium';
}

export function storedQualityChoice(): 'auto' | Quality {
  const v = localStorage.getItem('bl_quality');
  return v === 'low' || v === 'medium' || v === 'high' ? v : 'auto';
}
export function effectiveQuality(): Quality {
  const c = storedQualityChoice();
  return c === 'auto' ? recommendedQuality() : c;
}
export function setQualityChoice(q: 'auto' | Quality): void { localStorage.setItem('bl_quality', q); }

export const QUALITY_SETTINGS: Record<Quality, { pixelRatioMax: number; shadows: boolean; shadowSize: number; antialias: boolean; bloom: boolean }> = {
  low: { pixelRatioMax: 1, shadows: false, shadowSize: 0, antialias: false, bloom: false },
  medium: { pixelRatioMax: 1.5, shadows: true, shadowSize: 1024, antialias: true, bloom: false },
  high: { pixelRatioMax: 2, shadows: true, shadowSize: 2048, antialias: true, bloom: false },
};
