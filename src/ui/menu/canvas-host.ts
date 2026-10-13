// A picture that a GuiObject of the game draws (the minimap of minimap.ts),
// shown inside a window of the page. Not part of Freeserf.
//
// The object keeps its own frame and draws as before; the host gives it the
// <canvas> of the window as the frame to draw on (GuiObject.draw()), and
// sends the clicks, the drags and the keys of that canvas to the object as
// events in the object's own pixels (GuiObject.handleEvent()). The object
// does not know that it is not on the screen of the game.
//
// Use, with any GuiObject that has no parent:
//
//   const host = canvasHost({ object: minimap, width: 128, height: 128,
//                             label: 'Map of the world' });
//   win.add(host);       // update() draws again, dispose() destroys
//   host.redraw();       // after a change the object does not know of

import './canvas-host.css';

import { Event, EventButton, EventType } from '../event-loop';
import { Frame } from '../gfx';
import type { GuiObject } from '../gui';
import { Video, VideoFrame } from '../video';
import type { Widget } from './kit';

export interface CanvasHostOptions {
  /* The object to show. The host sets its size and its place (0, 0) and
     displays it. */
  object: GuiObject;
  /* The size of the object in its own pixels: the pixels of the canvas. */
  width: number;
  height: number;
  /* What the picture is, for a screen reader and as the tooltip. */
  label: string;
  /* The picture is drawn again at least this often by update() (1000 ms).
     0: at every update. Drawing a large map is not cheap, and the object
     does not say when the game has changed under it. */
  refreshMs?: number;
  /* Send drags to the object (handleDrag). On unless false. */
  drag?: boolean;
  /* The canvas takes the focus: the arrows drag by keyStep pixels of the
     object, Enter and Space click its middle. On unless false. */
  keys?: boolean;
  keyStep?: number;
  /* dispose() destroys the object too. On unless false. */
  destroyObject?: boolean;
  /* Called after an event was given to the object, with what it was. */
  onInput?(kind: 'click' | 'drag'): void;
}

export interface CanvasHost extends Widget {
  readonly canvas: HTMLCanvasElement;
  /* Draw the object again now. */
  redraw(): void;
}

/* A drag shorter than this (page pixels) is a click. */
const clickSlack = 4;

export function canvasHost(options: CanvasHostOptions): CanvasHost {
  const { object, width, height } = options;
  const refreshMs = options.refreshMs ?? 1000;
  const keyStep = options.keyStep ?? 8;

  const canvas = document.createElement('canvas');
  canvas.className = 'cvh-canvas';
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.label);
  canvas.title = options.label;
  /* The size on the page: one pixel of the object is one pixel of the game
     art (--gx-px), smaller when the window is. */
  canvas.style.width = `calc(${width} * var(--gx-px))`;
  canvas.style.aspectRatio = `${width} / ${height}`;

  /* The canvas of the page as a frame of the game. */
  const ctx = canvas.getContext('2d');
  let frame: Frame | null = null;
  if (ctx !== null) {
    ctx.imageSmoothingEnabled = false;
    const videoFrame = new VideoFrame();
    videoFrame.texture = canvas;
    videoFrame.ctx = ctx;
    videoFrame.scale = 1;
    /* Not the owner of the canvas: destroy() leaves it alone. */
    frame = new Frame(Video.getInstance(), videoFrame);
  }

  object.setSize(width, height);
  object.moveTo(0, 0);
  object.setDisplayed(true);

  let disposed = false;
  let lastDraw = -Infinity;

  const redraw = (): void => {
    if (disposed || frame === null || ctx === null) return;
    lastDraw = performance.now();
    object.setRedraw();
    ctx.clearRect(0, 0, width, height);
    object.draw(frame);
  };

  const update = (): void => {
    if (performance.now() - lastDraw >= refreshMs) redraw();
  };

  /* A place of the page in the pixels of the object. */
  const toObject = (clientX: number, clientY: number): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) * width) / (rect.width || 1));
    const y = Math.floor(((clientY - rect.top) * height) / (rect.height || 1));
    return [Math.max(0, Math.min(width - 1, x)), Math.max(0, Math.min(height - 1, y))];
  };

  const send = (type: EventType, x: number, y: number, dx: number, dy: number, button: EventButton): void => {
    if (disposed) return;
    const event = new Event();
    event.type = type;
    event.x = x;
    event.y = y;
    event.dx = dx;
    event.dy = dy;
    event.button = button;
    object.handleEvent(event);
    /* The object may have closed the window (the minimap does on a click). */
    if (disposed) return;
    options.onInput?.(type === EventType.TypeDrag ? 'drag' : 'click');
    redraw();
  };

  const click = (x: number, y: number, button: EventButton): void => {
    send(EventType.TypeClick, x, y, 0, 0, button);
  };

  const dragBy = (x: number, y: number, dx: number, dy: number, button: EventButton): void => {
    if (options.drag === false || (dx === 0 && dy === 0)) return;
    send(EventType.TypeDrag, x, y, dx, dy, button);
  };

  /* The pointer: a press and a release in one place is a click, a press
     that moves is a drag in steps, as the event loop of the game sends
     them (the step since the last one, the place of the start). */
  let press: {
    id: number;
    button: EventButton;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    restX: number;
    restY: number;
    moved: boolean;
  } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    press = {
      id: e.pointerId,
      button: e.button === 2 ? EventButton.ButtonRight : EventButton.ButtonLeft,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      restX: 0,
      restY: 0,
      moved: false,
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (options.keys !== false) canvas.focus({ preventScroll: true });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (press === null || e.pointerId !== press.id) return;
    if (
      !press.moved &&
      Math.abs(e.clientX - press.startX) < clickSlack &&
      Math.abs(e.clientY - press.startY) < clickSlack
    ) {
      return;
    }
    press.moved = true;
    const rect = canvas.getBoundingClientRect();
    press.restX += ((e.clientX - press.lastX) * width) / (rect.width || 1);
    press.restY += ((e.clientY - press.lastY) * height) / (rect.height || 1);
    press.lastX = e.clientX;
    press.lastY = e.clientY;
    const dx = Math.trunc(press.restX);
    const dy = Math.trunc(press.restY);
    press.restX -= dx;
    press.restY -= dy;
    const [x, y] = toObject(press.startX, press.startY);
    dragBy(x, y, dx, dy, press.button);
  });

  const release = (e: PointerEvent, cancelled: boolean): void => {
    if (press === null || e.pointerId !== press.id) return;
    const done = press;
    press = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (cancelled || done.moved) return;
    const [x, y] = toObject(e.clientX, e.clientY);
    click(x, y, done.button);
  };
  canvas.addEventListener('pointerup', (e) => release(e, false));
  canvas.addEventListener('pointercancel', (e) => release(e, true));
  /* The right button is the special click of the game, not the menu of the
     browser. */
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  if (options.keys !== false) {
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      const cx = Math.trunc(width / 2);
      const cy = Math.trunc(height / 2);
      let used = true;
      if (e.key === 'ArrowLeft') dragBy(cx, cy, -keyStep, 0, EventButton.ButtonLeft);
      else if (e.key === 'ArrowRight') dragBy(cx, cy, keyStep, 0, EventButton.ButtonLeft);
      else if (e.key === 'ArrowUp') dragBy(cx, cy, 0, -keyStep, EventButton.ButtonLeft);
      else if (e.key === 'ArrowDown') dragBy(cx, cy, 0, keyStep, EventButton.ButtonLeft);
      else if (e.key === 'Enter' || e.key === ' ') click(cx, cy, EventButton.ButtonLeft);
      else used = false;
      if (used) {
        e.preventDefault();
        /* Not the map view of the game too. */
        e.stopPropagation();
      }
    });
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    press = null;
    if (frame !== null) {
      frame.destroy();
      frame = null;
    }
    if (options.destroyObject !== false) object.destroy();
  };

  redraw();
  return { el: canvas, canvas, update, redraw, dispose };
}
