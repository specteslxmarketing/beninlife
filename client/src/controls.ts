/** Unified input: keyboard (WASD/arrows), on-screen joystick (touch), camera drag (mouse/touch). */
/** setPointerCapture throws NotFoundError in WebKit when the pointer is no longer active; capture is best-effort */
export function safeCapture(el: Element, id: number): void { try { el.setPointerCapture(id); } catch { /* pointer already gone */ } }

export class Controls {
  keys = new Set<string>();
  joy = { x: 0, y: 0, active: false };
  camYaw = 0; camPitch = 0.28;
  private onPress = new Map<string, () => void>();
  isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 1;
  /** on-screen buttons (touch): held brake, sprint toggle */
  touchBrake = false; sprintToggle = false;
  enabled = true;

  constructor(private canvas: HTMLCanvasElement, joyEl: HTMLElement, knob: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (!e.repeat && this.enabled) this.onPress.get(k)?.();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // camera drag (mouse anywhere on canvas, touch on canvas outside joystick)
    let drag: { id: number; x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; safeCapture(canvas, e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      this.camYaw -= dx * 0.006; this.camPitch = Math.max(0.05, Math.min(1.2, this.camPitch + dy * 0.004));
    });
    const end = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

    // joystick
    let jid: number | null = null; let cx = 0, cy = 0;
    let R = 50; // knob travel scales with the joystick size (bigger on iPad)
    joyEl.addEventListener('pointerdown', (e) => {
      jid = e.pointerId; safeCapture(joyEl, e.pointerId);
      const r = joyEl.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = Math.max(40, r.width * 0.36); this.joy.active = true; move(e); e.preventDefault();
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== jid) return;
      let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.joy.x = dx / R; this.joy.y = -dy / R; knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    joyEl.addEventListener('pointermove', move);
    const jend = (e: PointerEvent) => { if (e.pointerId !== jid) return; jid = null; this.joy = { x: 0, y: 0, active: false }; knob.style.transform = ''; };
    joyEl.addEventListener('pointerup', jend); joyEl.addEventListener('pointercancel', jend);
  }

  on(key: string, fn: () => void): void { this.onPress.set(key, fn); }
  /** fire a key action from an on-screen button */
  press(key: string): void { if (this.enabled) this.onPress.get(key)?.(); }

  /** Returns movement axes: x = right, y = forward, each -1..1 */
  axes(): { x: number; y: number; sprint: boolean } {
    if (!this.enabled) return { x: 0, y: 0, sprint: false };
    let x = 0, y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.joy.active) { x = this.joy.x; y = this.joy.y; }
    const sprint = this.keys.has('shift') || this.sprintToggle || (this.joy.active && Math.hypot(this.joy.x, this.joy.y) > 0.92);
    return { x, y, sprint };
  }
  brake(): boolean { return this.enabled && (this.keys.has(' ') || this.touchBrake); }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
