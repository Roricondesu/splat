export interface InputState {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  firing: boolean;
  jump: boolean;
  dash: boolean;
}

export class InputController {
  state: InputState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, firing: false, jump: false, dash: false };
  private keys = new Set<string>();
  private swipeLookId: number | null = null;
  private swipePointerType: string | null = null;
  private lastSwipeX = 0;
  private lastSwipeY = 0;
  private surface: HTMLElement;
  private jumpQueued = false;
  private mobileMoveX = 0;
  private mobileMoveY = 0;
  private mobileDash = false;
  private disposers: Array<() => void> = [];

  private listen<T extends EventTarget>(target: T, type: string, handler: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }

  constructor(private canvas: HTMLCanvasElement) {
    this.surface = canvas.closest<HTMLElement>('.game-screen') ?? canvas;
    this.listen(window, 'keydown', (event: Event) => {
      const e = event as KeyboardEvent;
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.jumpQueued = true;
      }
    });
    this.listen(window, 'keyup', (event: Event) => this.keys.delete((event as KeyboardEvent).code));
    this.listen(this.surface, 'pointerdown', (event: Event) => {
      const e = event as PointerEvent;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, .modal-layer, .mobile-controls')) return;
      if (e.pointerType === 'touch' || e.pointerType === 'pen' || e.pointerType === 'mouse') {
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
        e.preventDefault();
        this.swipeLookId = e.pointerId;
        this.swipePointerType = e.pointerType;
        this.lastSwipeX = e.clientX;
        this.lastSwipeY = e.clientY;
        if (e.pointerType === 'mouse' && e.button === 0) this.state.firing = true;
        if (this.surface.hasPointerCapture?.(e.pointerId) === false) {
          try { this.surface.setPointerCapture?.(e.pointerId); } catch { /* synthetic events may not own a native pointer */ }
        }
      }
    });
    this.listen(this.surface, 'pointermove', (event: Event) => {
      const e = event as PointerEvent;
      if (e.pointerId !== this.swipeLookId) return;
      e.preventDefault();
      this.state.lookX += (e.clientX - this.lastSwipeX) * 1.15;
      this.state.lookY += (e.clientY - this.lastSwipeY) * 1.15;
      this.lastSwipeX = e.clientX;
      this.lastSwipeY = e.clientY;
    });
    const stopSwipeLook = (e: PointerEvent) => {
      if (e.pointerId !== this.swipeLookId) return;
      if (this.swipePointerType === 'mouse' && e.button === 0) this.state.firing = false;
      this.swipeLookId = null;
      this.swipePointerType = null;
    };
    this.listen(this.surface, 'pointerup', stopSwipeLook as EventListener);
    this.listen(this.surface, 'pointercancel', stopSwipeLook as EventListener);
    this.listen(window, 'pointerup', (event: Event) => {
      const e = event as PointerEvent;
      if (e.button === 0) this.state.firing = false;
      stopSwipeLook(e);
    });
    this.listen(window, 'blur', () => {
      this.state.firing = false;
      this.keys.clear();
      this.swipeLookId = null;
      this.swipePointerType = null;
    });
    this.listen(canvas, 'contextmenu', (event: Event) => event.preventDefault());
  }

  dispose() {
    this.disposers.forEach(dispose => dispose());
    this.disposers = [];
    this.keys.clear();
    this.state.firing = false;
    this.mobileMoveX = 0;
    this.mobileMoveY = 0;
    this.mobileDash = false;
  }

  update() {
    this.state.moveX = Math.max(-1, Math.min(1, ((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)) + this.mobileMoveX));
    this.state.moveY = Math.max(-1, Math.min(1, ((this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)) + this.mobileMoveY));
    this.state.dash = this.mobileDash || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (this.keys.has('ArrowLeft')) this.state.lookX -= 3;
    if (this.keys.has('ArrowRight')) this.state.lookX += 3;
    if (this.keys.has('ArrowUp')) this.state.lookY -= 2;
    if (this.keys.has('ArrowDown')) this.state.lookY += 2;
  }

  consumeJump() {
    const queued = this.jumpQueued;
    this.jumpQueued = false;
    this.state.jump = false;
    return queued;
  }

  consumeLook() {
    const v = { x: this.state.lookX, y: this.state.lookY };
    this.state.lookX = 0; this.state.lookY = 0;
    return v;
  }

  bindMobileControls(root: HTMLElement) {
    const stick = root.querySelector<HTMLElement>('[data-stick]');
    const knob = root.querySelector<HTMLElement>('[data-stick-knob]');
    if (stick && knob) {
      let active = false;
      const move = (clientX: number, clientY: number) => {
        const r = stick.getBoundingClientRect();
        const dx = clientX - (r.left + r.width / 2);
        const dy = clientY - (r.top + r.height / 2);
        const max = r.width * 0.34;
        const len = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, max / len);
        const x = dx * k, y = dy * k;
        knob.style.transform = `translate(${x}px, ${y}px)`;
        this.mobileMoveX = x / max;
        this.mobileMoveY = -y / max;
      };
      this.listen(stick, 'pointerdown', (event: Event) => {
        const e = event as PointerEvent;
        e.preventDefault();
        e.stopPropagation();
        active = true;
        try { stick.setPointerCapture(e.pointerId); } catch { /* keep joystick usable for synthetic events */ }
        move(e.clientX, e.clientY);
      });
      this.listen(stick, 'pointermove', (event: Event) => {
        const e = event as PointerEvent;
        if (!active) return;
        e.preventDefault();
        e.stopPropagation();
        move(e.clientX, e.clientY);
      });
      const reset = () => { active = false; knob.style.transform = ''; this.mobileMoveX = 0; this.mobileMoveY = 0; };
      this.listen(stick, 'pointerup', reset);
      this.listen(stick, 'pointercancel', reset);
    }
    const fire = root.querySelector<HTMLElement>('[data-fire]');
    if (fire) {
      this.listen(fire, 'pointerdown', (event: Event) => { const e = event as PointerEvent; e.preventDefault(); this.state.firing = true; try { fire.setPointerCapture(e.pointerId); } catch { /* synthetic event */ } });
      this.listen(fire, 'pointerup', () => { this.state.firing = false; });
      this.listen(fire, 'pointercancel', () => { this.state.firing = false; });
    }
    const dash = root.querySelector<HTMLElement>('[data-dash]');
    if (dash) {
      this.listen(dash, 'pointerdown', (event: Event) => { const e = event as PointerEvent; e.preventDefault(); e.stopPropagation(); this.mobileDash = true; });
      this.listen(dash, 'pointerup', () => { this.mobileDash = false; });
      this.listen(dash, 'pointercancel', () => { this.mobileDash = false; });
    }
    const jump = root.querySelector<HTMLElement>('[data-jump]');
    if (jump) this.listen(jump, 'pointerdown', (event: Event) => {
      const e = event as PointerEvent;
      e.preventDefault();
      this.jumpQueued = true;
      this.state.jump = true;
    });
  }
}
