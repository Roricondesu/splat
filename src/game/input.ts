export interface InputState {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  firing: boolean;
  jump: boolean;
  waterBomb: boolean;
  submerge: boolean;
}

export class InputController {
  state: InputState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, firing: false, jump: false, waterBomb: false, submerge: false };
  private keys = new Set<string>();
  private swipeLookId: number | null = null;
  private swipePointerType: string | null = null;
  private lastSwipeX = 0;
  private lastSwipeY = 0;
  private surface: HTMLElement;
  private jumpQueued = false;
  private waterBombQueued = false;
  private fireQueued = false;
  private firePointerId: number | null = null;
  private submergePointerId: number | null = null;
  private floatingMovePointerId: number | null = null;
  private floatingCenterX = 0;
  private floatingCenterY = 0;
  private mobileMoveX = 0;
  private mobileMoveY = 0;
  private mobileSubmerge = false;
  private mobileStick?: HTMLElement;
  private mobileKnob?: HTMLElement;
  private disposers: Array<() => void> = [];

  private listen<T extends EventTarget>(target: T, type: string, handler: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }

  constructor(private canvas: HTMLCanvasElement, private joystickMode: 'fixed' | 'floating' = 'fixed') {
    this.surface = canvas.closest<HTMLElement>('.game-screen') ?? canvas;
    this.listen(window, 'keydown', (event: Event) => {
      const e = event as KeyboardEvent;
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.jumpQueued = true;
      }
      if (e.code === 'KeyQ' && !e.repeat) {
        e.preventDefault();
        this.waterBombQueued = true;
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
        if (this.joystickMode === 'floating' && e.pointerType !== 'mouse' && e.clientX < innerWidth * 0.46) {
          this.startFloatingStick(e.pointerId, e.clientX, e.clientY);
          return;
        }
        this.startLookPointer(e.pointerId, e.pointerType, e.clientX, e.clientY);
        if (e.pointerType === 'mouse' && e.button === 0) {
          this.state.firing = true;
          this.firePointerId = e.pointerId;
          this.fireQueued = true;
        }
      }
    });
    this.listen(this.surface, 'pointermove', (event: Event) => {
      const e = event as PointerEvent;
      if (e.pointerId === this.floatingMovePointerId) {
        e.preventDefault();
        this.updateFloatingStick(e.clientX, e.clientY);
        return;
      }
      if (e.pointerId !== this.swipeLookId) return;
      e.preventDefault();
      this.state.lookX += (e.clientX - this.lastSwipeX) * 1.15;
      this.state.lookY -= (e.clientY - this.lastSwipeY) * 1.15;
      this.lastSwipeX = e.clientX;
      this.lastSwipeY = e.clientY;
    });
    const stopSwipeLook = (e: PointerEvent) => {
      if (e.pointerId === this.floatingMovePointerId) {
        this.resetFloatingStick();
        return;
      }
      if (e.pointerId !== this.swipeLookId) return;
      if (e.pointerId === this.firePointerId) {
        this.state.firing = false;
        this.firePointerId = null;
      }
      this.swipeLookId = null;
      this.swipePointerType = null;
    };
    this.listen(this.surface, 'pointerup', stopSwipeLook as EventListener);
    this.listen(this.surface, 'pointercancel', stopSwipeLook as EventListener);
    this.listen(window, 'pointerup', (event: Event) => {
      const e = event as PointerEvent;
      if (e.pointerId === this.firePointerId) {
        this.state.firing = false;
        this.firePointerId = null;
      }
      if (e.pointerId === this.submergePointerId) {
        this.mobileSubmerge = false;
        this.submergePointerId = null;
      }
      stopSwipeLook(e);
    });
    this.listen(window, 'blur', () => {
      this.state.firing = false;
      this.state.submerge = false;
      this.mobileSubmerge = false;
      this.firePointerId = null;
      this.submergePointerId = null;
      this.resetFloatingStick();
      this.keys.clear();
      this.swipeLookId = null;
      this.swipePointerType = null;
    });
    this.listen(canvas, 'contextmenu', (event: Event) => event.preventDefault());
  }

  private startLookPointer(pointerId: number, pointerType: string, clientX: number, clientY: number) {
    if (this.swipeLookId !== null && this.swipeLookId !== pointerId) return;
    this.swipeLookId = pointerId;
    this.swipePointerType = pointerType;
    this.lastSwipeX = clientX;
    this.lastSwipeY = clientY;
    if (this.surface.hasPointerCapture?.(pointerId) === false) {
      try { this.surface.setPointerCapture?.(pointerId); } catch { /* synthetic events may not own a native pointer */ }
    }
  }

  private updateLookFromControl(e: PointerEvent) {
    if (e.pointerId !== this.swipeLookId) return;
    e.preventDefault();
    e.stopPropagation();
    this.state.lookX += (e.clientX - this.lastSwipeX) * 1.15;
    this.state.lookY -= (e.clientY - this.lastSwipeY) * 1.15;
    this.lastSwipeX = e.clientX;
    this.lastSwipeY = e.clientY;
  }

  private finishControlPointer(e: PointerEvent, control: 'fire' | 'submerge' | 'jump') {
    e.preventDefault();
    e.stopPropagation();
    if (control === 'fire' && e.pointerId === this.firePointerId) {
      this.state.firing = false;
      this.firePointerId = null;
    }
    if (control === 'submerge' && e.pointerId === this.submergePointerId) {
      this.mobileSubmerge = false;
      this.submergePointerId = null;
    }
    if (e.pointerId === this.swipeLookId) {
      this.swipeLookId = null;
      this.swipePointerType = null;
    }
  }

  private startFloatingStick(pointerId: number, clientX: number, clientY: number) {
    if (this.floatingMovePointerId !== null) return;
    this.floatingMovePointerId = pointerId;
    this.floatingCenterX = clientX;
    this.floatingCenterY = clientY;
    if (this.mobileStick) {
      this.mobileStick.classList.add('floating-active');
      this.mobileStick.style.left = `${clientX}px`;
      this.mobileStick.style.top = `${clientY}px`;
    }
    this.updateFloatingStick(clientX, clientY);
  }

  private updateFloatingStick(clientX: number, clientY: number) {
    const max = 38;
    const dx = clientX - this.floatingCenterX;
    const dy = clientY - this.floatingCenterY;
    const length = Math.hypot(dx, dy) || 1;
    const scale = Math.min(1, max / length);
    const x = dx * scale;
    const y = dy * scale;
    this.mobileMoveX = x / max;
    this.mobileMoveY = -y / max;
    if (this.mobileKnob) this.mobileKnob.style.transform = `translate(${x}px, ${y}px)`;
  }

  private resetFloatingStick() {
    this.floatingMovePointerId = null;
    this.mobileMoveX = 0;
    this.mobileMoveY = 0;
    if (this.mobileKnob) this.mobileKnob.style.transform = '';
    if (this.mobileStick) {
      this.mobileStick.classList.remove('floating-active');
      this.mobileStick.style.left = '';
      this.mobileStick.style.top = '';
    }
  }

  dispose() {
    this.disposers.forEach(dispose => dispose());
    this.disposers = [];
    this.keys.clear();
    this.state.firing = false;
    this.fireQueued = false;
    this.mobileMoveX = 0;
    this.mobileMoveY = 0;
    this.mobileSubmerge = false;
    this.state.submerge = false;
    this.firePointerId = null;
    this.submergePointerId = null;
    this.resetFloatingStick();
  }

  update() {
    this.state.moveX = Math.max(-1, Math.min(1, ((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)) + this.mobileMoveX));
    this.state.moveY = Math.max(-1, Math.min(1, ((this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)) + this.mobileMoveY));
    this.state.submerge = this.mobileSubmerge || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
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

  consumeWaterBomb() {
    const queued = this.waterBombQueued;
    this.waterBombQueued = false;
    this.state.waterBomb = false;
    return queued;
  }

  consumeFirePress() {
    const queued = this.fireQueued;
    this.fireQueued = false;
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
    this.mobileStick = stick ?? undefined;
    this.mobileKnob = knob ?? undefined;
    root.classList.toggle('floating-joystick', this.joystickMode === 'floating');
    if (stick && knob && this.joystickMode === 'fixed') {
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
      this.listen(fire, 'pointerdown', (event: Event) => {
        const e = event as PointerEvent;
        e.preventDefault();
        e.stopPropagation();
        this.state.firing = true;
        this.firePointerId = e.pointerId;
        this.fireQueued = true;
        this.startLookPointer(e.pointerId, e.pointerType, e.clientX, e.clientY);
      });
      this.listen(fire, 'pointermove', (event: Event) => this.updateLookFromControl(event as PointerEvent));
      this.listen(fire, 'pointerup', (event: Event) => this.finishControlPointer(event as PointerEvent, 'fire'));
      this.listen(fire, 'pointercancel', (event: Event) => this.finishControlPointer(event as PointerEvent, 'fire'));
    }
    const submerge = root.querySelector<HTMLElement>('[data-submerge]');
    if (submerge) {
      this.listen(submerge, 'pointerdown', (event: Event) => {
        const e = event as PointerEvent;
        e.preventDefault();
        e.stopPropagation();
        this.mobileSubmerge = true;
        this.submergePointerId = e.pointerId;
        this.startLookPointer(e.pointerId, e.pointerType, e.clientX, e.clientY);
      });
      this.listen(submerge, 'pointermove', (event: Event) => this.updateLookFromControl(event as PointerEvent));
      this.listen(submerge, 'pointerup', (event: Event) => this.finishControlPointer(event as PointerEvent, 'submerge'));
      this.listen(submerge, 'pointercancel', (event: Event) => this.finishControlPointer(event as PointerEvent, 'submerge'));
    }
    const bomb = root.querySelector<HTMLElement>('[data-water-bomb]');
    if (bomb) {
      this.listen(bomb, 'pointerdown', (event: Event) => {
        const e = event as PointerEvent;
        e.preventDefault();
        e.stopPropagation();
        this.waterBombQueued = true;
        this.state.waterBomb = true;
        this.startLookPointer(e.pointerId, e.pointerType, e.clientX, e.clientY);
      });
      this.listen(bomb, 'pointermove', (event: Event) => this.updateLookFromControl(event as PointerEvent));
      this.listen(bomb, 'pointerup', (event: Event) => this.finishControlPointer(event as PointerEvent, 'jump'));
      this.listen(bomb, 'pointercancel', (event: Event) => this.finishControlPointer(event as PointerEvent, 'jump'));
    }
    const jump = root.querySelector<HTMLElement>('[data-jump]');
    if (jump) {
      this.listen(jump, 'pointerdown', (event: Event) => {
        const e = event as PointerEvent;
        e.preventDefault();
        e.stopPropagation();
        this.jumpQueued = true;
        this.state.jump = true;
        this.startLookPointer(e.pointerId, e.pointerType, e.clientX, e.clientY);
      });
      this.listen(jump, 'pointermove', (event: Event) => this.updateLookFromControl(event as PointerEvent));
      this.listen(jump, 'pointerup', (event: Event) => this.finishControlPointer(event as PointerEvent, 'jump'));
      this.listen(jump, 'pointercancel', (event: Event) => this.finishControlPointer(event as PointerEvent, 'jump'));
    }
  }
}
