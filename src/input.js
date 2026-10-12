const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

// A touchscreen without a mouse: phones and tablets. A laptop with both keeps the
// keyboard layout until the player actually touches the screen.
export const isTouchDevice = () =>
  navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;

export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;
    this.onPress = null;
    this.padPrev = [];
    this.touch = { throttle: 0, brake: 0, left: false, right: false, handbrake: false };
    addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.onPress?.(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.releaseTouch(); });
    this.setupTouch();
  }

  // ── on-screen controls ──
  // Every live touch is hit-tested against the buttons instead of each button
  // tracking its own pointer: a finger can slide from one pedal to the other,
  // several buttons can be held at once, and nothing stays stuck down.
  setupTouch() {
    const root = document.getElementById('touch');
    if (!root) return;
    this.ctls = [...root.querySelectorAll('[data-ctl]')];

    const reveal = () => document.documentElement.classList.add('touch');
    if (isTouchDevice()) reveal();
    addEventListener('touchstart', reveal, { once: true, passive: true });

    for (const b of root.querySelectorAll('[data-press]')) {
      b.addEventListener('click', (e) => { e.preventDefault(); this.onPress?.(b.dataset.press); });
    }

    const hit = (t) => document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-ctl]');
    const refresh = (e) => {
      const held = new Set();
      for (const t of e.touches) {
        const el = hit(t);
        if (el) held.add(el);
      }
      const c = this.touch;
      c.throttle = 0; c.brake = 0; c.left = false; c.right = false; c.handbrake = false;
      for (const el of held) {
        const k = el.dataset.ctl;
        if (k === 'throttle') c.throttle = 1;
        else if (k === 'brake') c.brake = 1;
        else if (k === 'left') c.left = true;
        else if (k === 'right') c.right = true;
        else if (k === 'handbrake') c.handbrake = true;
      }
      for (const el of this.ctls) el.classList.toggle('on', held.has(el));
    };

    const onStart = (e) => {
      // Swallow the gesture only over a control, so the menu's own taps keep working.
      if (hit(e.changedTouches[0])) e.preventDefault();
      refresh(e);
    };
    addEventListener('touchstart', onStart, { passive: false });
    addEventListener('touchmove', refresh, { passive: true });
    addEventListener('touchend', refresh, { passive: true });
    addEventListener('touchcancel', refresh, { passive: true });
  }

  releaseTouch() {
    const c = this.touch;
    c.throttle = 0; c.brake = 0; c.left = false; c.right = false; c.handbrake = false;
    for (const el of this.ctls || []) el.classList.remove('on');
  }

  sample(dt) {
    const k = this.keys, tc = this.touch;
    let throttle = k.has('ArrowUp') || k.has('KeyW') ? 1 : tc.throttle;
    let brake = k.has('ArrowDown') || k.has('KeyS') ? 1 : tc.brake;
    let handbrake = k.has('Space') || tc.handbrake;
    const left = k.has('ArrowLeft') || k.has('KeyA') || tc.left;
    const right = k.has('ArrowRight') || k.has('KeyD') || tc.right;
    const target = (left ? 1 : 0) - (right ? 1 : 0);

    // keyboard / touch steering ramps in, snaps back faster
    const reversing = target !== 0 && Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0;
    const rate = target === 0 ? 8 : reversing ? 12 : 5.5;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    let steer = this.steer;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p) => p && p.connected);
    if (gp) {
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.08) steer = -Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.4;
      const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
      if (rt > 0.04) throttle = Math.max(throttle, rt);
      if (lt > 0.04) brake = Math.max(brake, lt);
      if (gp.buttons[1]?.pressed) handbrake = true;
      // edge-triggered buttons: Y camera, Start pause, Back reset
      const map = { 3: 'KeyC', 9: 'Escape', 8: 'KeyR', 0: 'Enter' };
      for (const [i, code] of Object.entries(map)) {
        const p = !!gp.buttons[i]?.pressed;
        if (p && !this.padPrev[i]) this.onPress?.(code);
        this.padPrev[i] = p;
      }
    }
    return { throttle, brake, steer, handbrake };
  }
}
