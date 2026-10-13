// event_loop.h + event_loop.cc + event_loop-sdl.cc - User and system
// events handling
//
// PORT: the SDL event loop is replaced by the DOM events of the canvas of
// the screen (see video.ts) and requestAnimationFrame.

import { TICK_LENGTH } from './freeserf';
import { Frame, Graphics, Image } from './gfx';
import { Video } from './video';

export enum EventType {
  TypeClick,
  TypeDoubleClick,
  TypeDrag,
  TypeKeyPressed,
  TypeResize,
  TypeUpdate,
  TypeDraw,
  /* The pictures kept by the GUI objects were lost. */
  TypeInvalidate,
}

export enum EventButton {
  ButtonLeft = 1,
  ButtonMiddle,
  ButtonRight,
}

// PORT: has the name of the Event of the DOM, which is globalThis.Event in
// a module that imports this class.
export class Event {
  static Type = EventType;
  static Button = EventButton;

  // The Frame to draw on, for TypeDraw.
  object: unknown = null;
  x = 0;
  y = 0;
  dx = 0;
  dy = 0;
  type: EventType = EventType.TypeClick;
  button: EventButton = EventButton.ButtonLeft;
}

// Timer::Handler
export interface TimerHandler {
  onTimerFired(id: number): void;
}

export abstract class Timer {
  protected id: number;
  protected interval: number;
  protected handler: TimerHandler | null;

  protected constructor(id: number, interval: number, handler: TimerHandler | null) {
    this.id = id;
    this.interval = interval;
    this.handler = handler;
  }

  // PORT: the destructor; call it where the C++ deletes the timer.
  destroy(): void {
    this.stop();
  }

  abstract run(): void;
  abstract stop(): void;

  static create(id: number, interval: number, handler: TimerHandler | null): Timer {
    return new TimerDOM(id, interval, handler);
  }
}

class TimerDOM extends Timer {
  protected timerId: ReturnType<typeof setInterval> | null = null;

  constructor(id: number, interval: number, handler: TimerHandler | null) {
    super(id, interval, handler);
  }

  run(): void {
    if (this.timerId === null) {
      this.timerId = setInterval(() => TimerDOM.callback(this), this.interval);
    }
  }

  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  static callback(timer: TimerDOM): void {
    if (timer.handler !== null) {
      timer.handler.onTimerFired(timer.id);
    }
  }
}

// EventLoop::Handler
export interface EventLoopHandler {
  handleEvent(event: Event): boolean;
}

// PORT: void* data becomes unknown.
export type DeferredCall = (data: unknown) => void;

export abstract class EventLoop {
  protected eventHandlers: EventLoopHandler[] = [];
  protected removed: EventLoopHandler[] = [];
  protected static instance: EventLoop | null = null;

  static getInstance(): EventLoop {
    if (EventLoop.instance === null) {
      EventLoop.instance = new EventLoopDOM();
    }
    return EventLoop.instance;
  }

  // PORT: run() can not block in the browser. It starts the loop and
  // returns at once; the promise is resolved when the loop ends after
  // quit(), so `await eventLoop.run()` continues where the C++ does.
  abstract run(): Promise<void>;
  abstract quit(): void;
  abstract deferredCall(call: DeferredCall, data: unknown): void;
  /* Milliseconds since the start. */
  abstract getTicks(): number;

  addHandler(handler: EventLoopHandler): void {
    this.eventHandlers.push(handler);
  }

  delHandler(handler: EventLoopHandler): void {
    this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    this.removed.push(handler);
  }

  protected constructor() {}

  protected notifyHandlers(event: Event): boolean {
    if (this.eventHandlers.length === 0) {
      return false;
    }

    let result = false;

    const handlers = this.eventHandlers.slice();
    for (const handler of handlers) {
      if (this.removed.indexOf(handler) === -1) {
        // Not short-circuit: result |= handler->handle_event(event)
        const handled = handler.handleEvent(event);
        result = result || handled;
      }
    }

    this.removed = [];

    return result;
  }

  protected notifyClick(x: number, y: number, button: EventButton): boolean {
    const event = new Event();
    event.type = EventType.TypeClick;
    event.x = x;
    event.y = y;
    event.button = button;
    return this.notifyHandlers(event);
  }

  protected notifyDblClick(x: number, y: number, button: EventButton): boolean {
    const event = new Event();
    event.type = EventType.TypeDoubleClick;
    event.x = x;
    event.y = y;
    event.button = button;
    return this.notifyHandlers(event);
  }

  protected notifyDrag(x: number, y: number, dx: number, dy: number, button: EventButton): boolean {
    const event = new Event();
    event.type = EventType.TypeDrag;
    event.x = x;
    event.y = y;
    event.dx = dx;
    event.dy = dy;
    event.button = button;
    return this.notifyHandlers(event);
  }

  protected notifyKeyPressed(key: number, morifier: number): boolean {
    const event = new Event();
    event.type = EventType.TypeKeyPressed;
    event.x = 0;
    event.y = 0;
    event.dx = key & 0xff;
    event.dy = morifier & 0xff;
    return this.notifyHandlers(event);
  }

  protected notifyResize(width: number, height: number): boolean {
    const event = new Event();
    event.type = EventType.TypeResize;
    event.x = 0;
    event.y = 0;
    event.dx = width;
    event.dy = height;
    return this.notifyHandlers(event);
  }

  protected notifyInvalidate(): boolean {
    const event = new Event();
    event.type = EventType.TypeInvalidate;
    event.x = 0;
    event.y = 0;
    event.dx = 0;
    event.dy = 0;
    return this.notifyHandlers(event);
  }

  protected notifyUpdate(): boolean {
    const event = new Event();
    event.type = EventType.TypeUpdate;
    event.x = 0;
    event.y = 0;
    return this.notifyHandlers(event);
  }

  protected notifyDraw(frame: Frame): boolean {
    const event = new Event();
    event.type = EventType.TypeDraw;
    event.x = 0;
    event.y = 0;
    event.object = frame;
    return this.notifyHandlers(event);
  }
}

/* How fast consequtive mouse events need to be generated
 in order to be interpreted as click and double click. */
const MOUSE_TIME_SENSITIVITY = 600;
/* How much the mouse can move between events to be still
 considered as a double click. */
const MOUSE_MOVE_SENSITIVITY = 8;

const kMaxCatchUpSteps = 5;

const ch = (c: string): number => c.charCodeAt(0);

/* The buttons of SDL (1 left, 2 middle, 3 right) in MouseEvent.buttons. */
const buttonMask = [0, 1, 4, 2];

/* Key symbols without the modifiers of the keys that are not letters, by
   KeyboardEvent.code (US layout). */
const unshiftedKeys: Record<string, string> = {
  Backquote: '`',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  Digit0: '0',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/* The keys without a character, the key codes of SDL in 8 bits. */
const namedKeys: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Tab: 9,
  Delete: 127,
};

export class EventLoopDOM extends EventLoop {
  protected deferredCalls: DeferredCall[] = [];
  protected zoomFactor = 1; // Zoom of the whole screen (panel and boxes)
  // PORT: the C++ has one zoom level that magnifies the screen up to two
  // times and gives the rest to the map. Here the two are set separately:
  // uiScale is device pixels per pixel of the panel and the boxes, mapScale
  // device pixels per pixel of the map.
  protected uiScale = 1;
  protected mapScale = 1;
  protected screenFactorX = 1;
  protected screenFactorY = 1;

  /* Mouse state between events. */
  protected dragButton = 0;
  protected dragX = 0;
  protected dragY = 0;
  protected lastClick = [0, 0, 0, 0, 0, 0];
  protected lastClickX = 0;
  protected lastClickY = 0;

  protected screen: Frame | null = null;

  // PORT: state of the browser loop, not in the C++.
  protected startTime = performance.now();
  protected running = false;
  protected nextStep = 0;
  protected animationFrame = 0;
  protected quitResolve: (() => void) | null = null;
  protected canvas: HTMLCanvasElement | null = null;
  protected listeners: Array<() => void> = [];
  /* Buttons pressed on the canvas and not released yet (as
     MouseEvent.buttons). */
  protected pressed = 0;
  /* Position of the last drag step: the mouse can not be moved back to
     the start of the drag as the C++ does. */
  protected dragLastX = 0;
  protected dragLastY = 0;
  protected wheelRest = 0;
  protected outputWidth = 0;
  protected outputHeight = 0;

  constructor() {
    super();
  }

  quit(): void {
    // PORT: SDL_PushEvent of the quit event; the loop ends after the
    // handler that called quit() has returned.
    setTimeout(() => this.end(), 0);
  }

  deferredCall(call: DeferredCall, data: unknown): void {
    this.deferredCalls.push(call);

    // PORT: SDL_PushEvent of the call event. The data is not passed on, as
    // in the C++.
    void data;
    setTimeout(() => {
      while (this.deferredCalls.length > 0) {
        const deferred = this.deferredCalls.shift() as DeferredCall;
        deferred(null);
      }
    }, 0);
  }

  /* Position of a mouse event in the canvas element (the window
     coordinates of SDL). */
  protected position(event: MouseEvent): [number, number] {
    const rect = (this.canvas as HTMLCanvasElement).getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  protected toScreenX(x: number): number {
    return Math.trunc(Math.fround(Math.fround(x * this.zoomFactor) * this.screenFactorX));
  }

  protected toScreenY(y: number): number {
    return Math.trunc(Math.fround(Math.fround(y * this.zoomFactor) * this.screenFactorY));
  }

  // event_loop() has been turned into a SDL based loop.
  // The code for one iteration of the original game_loop is in game_loop_iter.
  /* Handle one SDL event; false when the loop has to end. */
  // PORT: handle_sdl_event() is split into one handler per DOM event.

  // SDL_EVENT_MOUSE_BUTTON_UP
  protected handleMouseButtonUp(event: MouseEvent): void {
    // PORT: only for the buttons pressed on the canvas; the events come
    // from the window to get the release outside of the canvas too.
    const button = event.button + 1;
    if (button > 3) return;
    const mask = buttonMask[button];
    if ((this.pressed & mask) === 0) return;
    this.pressed &= ~mask;
    event.preventDefault();

    const currentTicks = this.getTicks();
    const [ex, ey] = this.position(event);

    if (this.dragButton === button) {
      this.dragButton = 0;
    }

    if (button <= 3) {
      const x = this.toScreenX(ex);
      const y = this.toScreenY(ey);
      this.notifyClick(x, y, button as EventButton);

      const bx = Math.trunc(ex);
      const by = Math.trunc(ey);
      if (
        currentTicks - this.lastClick[button] < MOUSE_TIME_SENSITIVITY &&
        bx >= this.lastClickX - MOUSE_MOVE_SENSITIVITY &&
        bx <= this.lastClickX + MOUSE_MOVE_SENSITIVITY &&
        by >= this.lastClickY - MOUSE_MOVE_SENSITIVITY &&
        by <= this.lastClickY + MOUSE_MOVE_SENSITIVITY
      ) {
        this.notifyDblClick(x, y, button as EventButton);
      }

      this.lastClick[button] = currentTicks;
      this.lastClickX = bx;
      this.lastClickY = by;
    }
  }

  // SDL_EVENT_MOUSE_BUTTON_DOWN
  protected handleMouseButtonDown(event: MouseEvent): void {
    // PORT: remember the button for the release and the drag (SDL captures
    // the mouse while a button is down), and keep the browser from
    // selecting text or scrolling with the middle button.
    const button = event.button + 1;
    if (button > 3) return;
    this.pressed |= buttonMask[button];
    event.preventDefault();
    // The keys go to the game again, not to a text field of the page.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      active.blur();
    }
  }

  // SDL_EVENT_MOUSE_MOTION
  protected handleMouseMotion(event: MouseEvent): void {
    // PORT: a button released outside of the browser window gives no
    // event, forget it here.
    this.pressed &= event.buttons;
    if (this.dragButton !== 0 && (this.pressed & buttonMask[this.dragButton]) === 0) {
      this.dragButton = 0;
    }
    if (this.pressed === 0) return;

    const [ex, ey] = this.position(event);
    const mx = Math.trunc(ex);
    const my = Math.trunc(ey);
    for (let button = 1; button <= 3; button++) {
      if (this.pressed & buttonMask[button]) {
        if (this.dragButton === 0) {
          this.dragButton = button;
          this.dragX = mx;
          this.dragY = my;
          this.dragLastX = mx;
          this.dragLastY = my;
          break;
        }

        const x = this.toScreenX(this.dragX);
        const y = this.toScreenY(this.dragY);
        // PORT: the C++ moves the mouse back to the start of the drag
        // after each step (SDL_WarpMouseInWindow), so that its dx, dy from
        // the start are the step. A page can not move the mouse: the step
        // is taken from the last position, the event keeps the position of
        // the start as in the C++.
        const dx = mx - this.dragLastX;
        const dy = my - this.dragLastY;
        if (dx === 0 && dy === 0) {
          break;
        }

        this.notifyDrag(x, y, dx, dy, this.dragButton as EventButton);

        this.dragLastX = mx;
        this.dragLastY = my;

        break;
      }
    }
  }

  // SDL_EVENT_MOUSE_WHEEL
  protected handleMouseWheel(event: WheelEvent): void {
    {
      // Not the zoom or the scrolling of the browser.
      event.preventDefault();

      /* Whole wheel steps only: trackpads send many fractional ones. */
      // PORT: SDL counts the steps of the wheel, positive away from the
      // user. The DOM gives pixels (about 100 for a step), lines (3) or
      // pages, positive towards the user.
      const unit = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100;
      this.wheelRest -= event.deltaY / unit;
      const steps = Math.trunc(this.wheelRest);
      this.wheelRest -= steps;
      if (steps !== 0) {
        if (event.ctrlKey) {
          this.stepUiScale(steps);
        } else {
          // PORT: not in the C++. The point of the map under the mouse
          // stays there.
          const [ex, ey] = this.position(event);
          this.stepMapScale(steps, [ex * this.screenFactorX, ey * this.screenFactorY]);
        }
      }
    }
  }

  /* Key symbols without the modifiers, as with SDL2. */
  // PORT: the DOM only gives the character with the modifiers applied.
  // Letters are made lower case; for another key pressed with shift the
  // character of the US layout is taken. 0: a key without a character
  // that the game does not use.
  protected keySym(event: KeyboardEvent): number {
    const key = event.key;
    if (key in namedKeys) {
      return namedKeys[key];
    }
    if (event.code.startsWith('Numpad')) {
      if (key === 'Enter') return 13;
      if (key.length === 1) return ch(key);
      return 0;
    }
    if ([...key].length !== 1) {
      return 0;
    }
    const lower = key.toLowerCase();
    if (lower !== key.toUpperCase()) {
      return (lower.codePointAt(0) as number) & 0xff; /* A letter. */
    }
    if (event.shiftKey && event.code in unshiftedKeys) {
      return ch(unshiftedKeys[event.code]);
    }
    return (key.codePointAt(0) as number) & 0xff;
  }

  // SDL_EVENT_KEY_DOWN
  protected handleKeyDown(event: KeyboardEvent): void {
    // PORT: the keys typed into a text field of the page are not for the
    // game.
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT')
    ) {
      return;
    }
    // PORT: the command key belongs to the browser.
    if (event.metaKey || event.isComposing) {
      return;
    }

    const gfx = Graphics.getInstance();
    // PORT: the default action of the browser (scrolling, moving the
    // focus, the menu) is prevented for the keys the game used.
    let handled = false;

    const sym = this.keySym(event);
    if (sym === ch('q') && event.ctrlKey) {
      this.quit();
      return;
    }

    let modifier = 0;
    if (event.ctrlKey) {
      modifier |= 1;
    }
    if (event.shiftKey) {
      modifier |= 2;
    }
    if (event.altKey) {
      modifier |= 4;
    }

    switch (event.key) {
      // Map scroll
      case 'ArrowUp': {
        this.notifyDrag(0, 0, 0, -32, EventButton.ButtonLeft);
        handled = true;
        break;
      }
      case 'ArrowDown': {
        this.notifyDrag(0, 0, 0, 32, EventButton.ButtonLeft);
        handled = true;
        break;
      }
      case 'ArrowLeft': {
        this.notifyDrag(0, 0, -32, 0, EventButton.ButtonLeft);
        handled = true;
        break;
      }
      case 'ArrowRight': {
        this.notifyDrag(0, 0, 32, 0, EventButton.ButtonLeft);
        handled = true;
        break;
      }

      // Misc
      case 'F10':
        handled = this.notifyKeyPressed(ch('n'), 1);
        break;

      default:
        switch (sym) {
          case 0:
            break;

          case 0x2b: // '+', also of the keypad
          case 0x3d: // '='
            handled = this.notifyKeyPressed(ch('+'), 0);
            break;
          case 0x2d: // '-', also of the keypad
            handled = this.notifyKeyPressed(ch('-'), 0);
            break;

          // Video
          case 0x66: // 'f'
            if (event.ctrlKey && !event.shiftKey) {
              gfx.setFullscreen(!gfx.isFullscreen());
              handled = true;
            } else {
              // if this isn't handled the 'f' key
              // doesn't work for savegame names
              handled = this.notifyKeyPressed(sym, modifier);
            }
            break;
          case 0x5d: // ']'
            this.stepMapScale(1);
            handled = true;
            break;
          case 0x5b: // '['
            this.stepMapScale(-1);
            handled = true;
            break;

          default:
            handled = this.notifyKeyPressed(sym, modifier);
            break;
        }
        break;
    }

    if (handled) {
      event.preventDefault();
    }
  }

  // SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED
  protected handleResize(): void {
    const gfx = Graphics.getInstance();
    const [width, height] = gfx.getResolution();
    // PORT: the DOM reports changes of the size from several sources, only
    // a new size is handled.
    if (width === this.outputWidth && height === this.outputHeight) {
      return;
    }
    this.outputWidth = width;
    this.outputHeight = height;

    gfx.setResolution(width, height, gfx.isFullscreen());
    [this.screenFactorX, this.screenFactorY] = gfx.getScreenFactor();
    this.applyZoom();
  }

  // SDL_EVENT_RENDER_DEVICE_RESET
  protected handleContextRestored(): void {
    /* All textures are gone, also the sprites. */
    Image.clearCache();
    /* The contents of the render targets are gone (Direct3D on window
       resize or device loss): make a new screen and draw everything
       again. */
    this.applyZoom();
    this.notifyInvalidate();
  }

  protected listen<E extends globalThis.Event>(
    target: EventTarget,
    type: string,
    listener: (event: E) => void,
    options?: AddEventListenerOptions,
  ): void {
    const wrapped = listener as unknown as EventListener;
    target.addEventListener(type, wrapped, options);
    this.listeners.push(() => target.removeEventListener(type, wrapped, options));
  }

  /* The game advances in fixed steps of TICK_LENGTH ms, as the original on
     the vertical blank. The steps follow the clock: when a frame took too
     long, the missed steps are made up before the next drawing, up to
     kMaxCatchUpSteps; beyond that the game slows down instead of freezing
     the screen. Between the steps the loop waits for events. */
  // PORT: the browser calls the handlers of the DOM events between the
  // animation frames; one pass of the loop of the C++ after its events is
  // step(), called for each animation frame. A hidden page gets no
  // animation frames: the game stands still until it is shown again.
  run(): Promise<void> {
    if (this.running) {
      return Promise.reject(new Error('The event loop is running.'));
    }

    const gfx = Graphics.getInstance();
    [this.screenFactorX, this.screenFactorY] = gfx.getScreenFactor();
    [this.outputWidth, this.outputHeight] = gfx.getResolution();
    this.applyZoom();

    const canvas = Video.getInstance().getCanvas();
    this.canvas = canvas;
    this.pressed = 0;
    this.listen<MouseEvent>(canvas, 'mousedown', (e) => this.handleMouseButtonDown(e));
    this.listen<MouseEvent>(window, 'mouseup', (e) => this.handleMouseButtonUp(e));
    this.listen<MouseEvent>(window, 'mousemove', (e) => this.handleMouseMotion(e));
    this.listen<WheelEvent>(canvas, 'wheel', (e) => this.handleMouseWheel(e), { passive: false });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen<KeyboardEvent>(window, 'keydown', (e) => this.handleKeyDown(e));
    this.listen(window, 'resize', () => this.handleResize());
    this.listen(document, 'fullscreenchange', () => this.handleResize());
    this.listen(canvas, 'contextrestored', () => this.handleContextRestored());
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        if (this.running) this.handleResize();
      });
      // PORT: the size in device pixels where the browser reports it: it
      // also changes with the pixel ratio alone (see Video).
      try {
        observer.observe(canvas, { box: 'device-pixel-content-box' });
      } catch {
        observer.observe(canvas);
      }
      this.listeners.push(() => observer.disconnect());
    }
    // PORT: SDL_EVENT_QUIT (closing the window asks with the quit box of
    // the game) has no counterpart, a page can not keep its tab open.

    this.nextStep = this.getTicks() + TICK_LENGTH;
    this.running = true;
    const frame = (): void => {
      if (!this.running) return;
      this.animationFrame = requestAnimationFrame(frame);
      this.step();
    };
    this.animationFrame = requestAnimationFrame(frame);

    return new Promise<void>((resolve) => {
      this.quitResolve = resolve;
    });
  }

  /* One pass of the loop of run() after the events. */
  protected step(): void {
    const gfx = Graphics.getInstance();

    const now = this.getTicks();
    if (now < this.nextStep) {
      return;
    }

    let steps = 0;
    while (now >= this.nextStep && steps < kMaxCatchUpSteps) {
      this.notifyUpdate();
      this.nextStep += TICK_LENGTH;
      steps++;
    }
    if (now >= this.nextStep) {
      this.nextStep = now + TICK_LENGTH;
    }

    if (this.screen === null) {
      this.screen = gfx.getScreenFrame();
    }
    this.notifyDraw(this.screen);
    gfx.swapBuffers();
  }

  /* The end of run(), after the quit event. */
  protected end(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    for (const remove of this.listeners) {
      remove();
    }
    this.listeners = [];

    if (this.screen !== null) {
      this.screen.destroy();
      this.screen = null;
    }

    const resolve = this.quitResolve;
    this.quitResolve = null;
    if (resolve !== null) {
      resolve();
    }
  }

  // PORT: not in the C++. The scales are device pixels per pixel of the
  // game, so the whole numbers give pixels that are all the same size, on
  // any display. The others are kept where a step would double the size
  // (1.5), and below 1, where the map is an overview and pixels are left
  // out anyway.
  static readonly uiScales = [1, 1.5, 2, 3, 4, 5, 6];
  static readonly mapScales = [0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8];

  getUiScale(): number {
    return this.uiScale;
  }

  getMapScale(): number {
    return this.mapScale;
  }

  // PORT: not in the C++. The "Smooth" mode: the map view is magnified with
  // a pixel-art filter (see Viewport.draw()).
  protected smooth = false;

  getSmooth(): boolean {
    return this.smooth;
  }

  setSmooth(smooth: boolean): void {
    this.smooth = smooth;
    this.storeScales();
    this.applyZoom();
  }

  /* The largest scale that still leaves room for the 352 pixel panel and
     the boxes of the game. */
  protected maxUiScale(): number {
    const [width, height] = Graphics.getInstance().getResolution();
    return Math.max(1, Math.min(width / 400, height / 300));
  }

  setUiScale(scale: number): void {
    const max = this.maxUiScale();
    const allowed = EventLoopDOM.uiScales.filter((v) => v <= max);
    this.uiScale = nearest(allowed.length > 0 ? allowed : [1], scale);
    this.storeScales();
    this.applyZoom();
  }

  /* anchor: the point of the screen, in device pixels, where the map stays
     in place; the middle of the map view without it. */
  setMapScale(scale: number, anchor: [number, number] | null = null): void {
    this.mapScale = nearest(EventLoopDOM.mapScales, scale);
    this.storeScales();
    const gfx = Graphics.getInstance();
    gfx.setMapZoomAnchor(anchor);
    this.applyZoom();
    gfx.setMapZoomAnchor(null);
  }

  stepUiScale(steps: number): void {
    this.setUiScale(step(EventLoopDOM.uiScales, this.uiScale, steps));
  }

  stepMapScale(steps: number, anchor: [number, number] | null = null): void {
    this.setMapScale(step(EventLoopDOM.mapScales, this.mapScale, steps), anchor);
  }

  /* The scales of the last visit, or the whole numbers of device pixels
     that make a pixel of the game about two CSS pixels for the panel and
     one and a half for the map. */
  protected loadScales(): void {
    const ratio = window.devicePixelRatio || 1;
    let ui = Math.max(1, Math.round(2 * ratio));
    let map = Math.max(1, Math.round(1.5 * ratio));
    try {
      const stored = JSON.parse(localStorage.getItem('settlers.scales') ?? 'null');
      if (stored !== null && typeof stored.ui === 'number' && typeof stored.map === 'number') {
        ui = stored.ui;
        map = stored.map;
        this.smooth = stored.smooth === true;
      }
    } catch {
      // No storage: the defaults.
    }
    const max = this.maxUiScale();
    const allowed = EventLoopDOM.uiScales.filter((v) => v <= max);
    this.uiScale = nearest(allowed.length > 0 ? allowed : [1], ui);
    this.mapScale = nearest(EventLoopDOM.mapScales, map);
  }

  protected storeScales(): void {
    try {
      localStorage.setItem(
        'settlers.scales',
        JSON.stringify({ ui: this.uiScale, map: this.mapScale, smooth: this.smooth }),
      );
    } catch {
      // No storage: the scales last until the page is closed.
    }
  }

  protected scalesLoaded = false;

  protected applyZoom(): void {
    const gfx = Graphics.getInstance();
    if (!this.scalesLoaded) {
      this.scalesLoaded = true;
      this.loadScales();
    }
    // PORT: the canvas keeps the size of the display in device pixels and
    // the screen frame gets the scale of the panel (see Video), so the map
    // is magnified once, from its own pixels to device pixels.
    gfx.setUiScale(this.uiScale);
    this.zoomFactor = gfx.getZoomFactor();
    gfx.setMapZoom(Math.fround(this.mapScale * this.zoomFactor));
    gfx.setMapScale(this.mapScale);
    gfx.setMapSmooth(this.smooth);

    const [width, height] = gfx.getLogicalSize();
    this.notifyResize(width, height);
  }

  getTicks(): number {
    return Math.trunc(performance.now() - this.startTime) >>> 0;
  }
}

function nearest(values: readonly number[], value: number): number {
  let best = values[0];
  for (const v of values) {
    if (Math.abs(v - value) < Math.abs(best - value)) best = v;
  }
  return best;
}

function step(values: readonly number[], value: number, steps: number): number {
  const i = values.indexOf(nearest(values, value));
  return values[Math.max(0, Math.min(values.length - 1, i + steps))];
}
