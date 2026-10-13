// gui.h + gui.cc - Base functions for the GUI hierarchy

import { clamp } from '../game/misc';
import { Event, EventButton, EventLoopHandler, EventType } from './event-loop';
import { Frame, Graphics } from './gfx';

/* Get the resulting value from a click on a slider bar. */
export function guiGetSliderClickValue(x: number): number {
  return 1310 * clamp(0, x - 7, 50);
}

export abstract class GuiObject implements EventLoopHandler {
  private floats: GuiObject[] = [];

  protected x: number;
  protected y: number;
  protected width: number;
  protected height: number;
  /* Magnification of the object on its parent: the frame and the
     coordinates inside are width x height, it takes width * zoom x
     height * zoom of the parent. */
  protected zoom: number;
  protected dragRestX: number;
  protected dragRestY: number;
  protected displayed: boolean;
  protected enabled: boolean;
  protected redraw: boolean;
  protected parent: GuiObject | null;
  protected frame: Frame | null;
  protected static focusedObject: GuiObject | null = null;
  protected focused: boolean;

  // PORT: audio is not ported. play_sound() calls this function when it is
  // set; the audio port sets it to Audio::get_instance().enqueue_sfx().
  static enqueueSfx: ((sound: number) => void) | null = null;

  protected abstract internalDraw(): void;

  protected layout(): void {}

  protected handleClickLeft(x: number, y: number): boolean {
    return false;
  }

  /* The original's special click (right button held). */
  protected handleClickRight(x: number, y: number): boolean {
    return false;
  }

  protected handleDblClick(x: number, y: number, button: EventButton): boolean {
    return false;
  }

  protected handleDrag(dx: number, dy: number): boolean {
    return true;
  }

  // key is the character code (char in the C++).
  protected handleKeyPressed(key: number, modifier: number): boolean {
    return false;
  }

  protected handleFocusLoose(): boolean {
    return false;
  }

  protected deleteFrame(): void {
    if (this.frame !== null) {
      this.frame.destroy();
      this.frame = null;
    }
  }

  protected outerWidth(): number {
    return Math.trunc(Math.fround(Math.fround(this.width * this.zoom) + 0.5));
  }

  protected outerHeight(): number {
    return Math.trunc(Math.fround(Math.fround(this.height * this.zoom) + 0.5));
  }

  constructor() {
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    this.zoom = 1;
    this.dragRestX = 0;
    this.dragRestY = 0;
    this.displayed = false;
    this.enabled = true;
    this.redraw = true;
    this.parent = null;
    this.frame = null;
    this.focused = false;
  }

  // PORT: the destructor. Call it where the C++ deletes the object; a
  // subclass with a destructor overrides it and calls super.destroy() last.
  destroy(): void {
    if (GuiObject.focusedObject === this) {
      GuiObject.focusedObject = null;
    }
    this.deleteFrame();
  }

  draw(_frame: Frame): void {
    if (!this.displayed) {
      return;
    }

    if (this.frame === null) {
      this.frame = Graphics.getInstance().createFrame(this.width, this.height);
    }

    if (this.redraw) {
      this.internalDraw();

      for (const floatWindow of this.floats) {
        floatWindow.draw(this.frame);
      }

      this.redraw = false;
    }
    if (this.zoom === 1) {
      _frame.drawFrame(this.x, this.y, 0, 0, this.frame, this.width, this.height);
    } else {
      _frame.drawFrameScaled(
        this.x,
        this.y,
        this.outerWidth(),
        this.outerHeight(),
        this.frame,
        this.width,
        this.height,
      );
    }
  }

  handleEvent(event: Event): boolean {
    if (!this.enabled || !this.displayed) {
      return false;
    }

    let eventX = event.x;
    let eventY = event.y;
    if (
      event.type === EventType.TypeClick ||
      event.type === EventType.TypeDoubleClick ||
      event.type === EventType.TypeDrag
    ) {
      eventX = event.x - this.x;
      eventY = event.y - this.y;
      if (eventX < 0 || eventY < 0 || eventX > this.outerWidth() || eventY > this.outerHeight()) {
        return false;
      }
      eventX = Math.trunc(Math.fround(eventX / this.zoom));
      eventY = Math.trunc(Math.fround(eventY / this.zoom));
    }

    const internalEvent = new Event();
    internalEvent.type = event.type;
    internalEvent.x = eventX;
    internalEvent.y = eventY;
    internalEvent.dx = event.dx;
    internalEvent.dy = event.dy;
    internalEvent.button = event.button;

    /* Find the corresponding float element if any */
    // PORT: over a copy of the list, a handler may add or delete floats.
    const floats = this.floats.slice();
    for (let fl = floats.length - 1; fl >= 0; fl--) {
      const result = floats[fl].handleEvent(internalEvent);
      if (result) {
        return result;
      }
    }

    let result = false;
    switch (event.type) {
      case EventType.TypeClick:
        if (event.button === EventButton.ButtonLeft) {
          result = this.handleClickLeft(eventX, eventY);
        } else if (event.button === EventButton.ButtonRight) {
          result = this.handleClickRight(eventX, eventY);
        }
        break;
      case EventType.TypeDrag: {
        /* Keep the fraction lost by the zoom for the next drag step. */
        this.dragRestX = Math.fround(this.dragRestX + Math.fround(event.dx / this.zoom));
        this.dragRestY = Math.fround(this.dragRestY + Math.fround(event.dy / this.zoom));
        const dx = Math.trunc(this.dragRestX);
        const dy = Math.trunc(this.dragRestY);
        this.dragRestX = Math.fround(this.dragRestX - dx);
        this.dragRestY = Math.fround(this.dragRestY - dy);
        result = this.handleDrag(dx, dy);
        break;
      }
      case EventType.TypeDoubleClick:
        result = this.handleDblClick(eventX, eventY, event.button);
        break;
      case EventType.TypeKeyPressed:
        result = this.handleKeyPressed(event.dx, event.dy);
        break;
      default:
        break;
    }

    if (result && GuiObject.focusedObject !== this) {
      if (GuiObject.focusedObject !== null) {
        GuiObject.focusedObject.focused = false;
        GuiObject.focusedObject.handleFocusLoose();
        GuiObject.focusedObject.setRedraw();
        GuiObject.focusedObject = null;
      }
    }

    return result;
  }

  setFocused(): void {
    if (GuiObject.focusedObject !== this) {
      if (GuiObject.focusedObject !== null) {
        GuiObject.focusedObject.focused = false;
        GuiObject.focusedObject.handleFocusLoose();
        GuiObject.focusedObject.setRedraw();
      }
      this.focused = true;
      GuiObject.focusedObject = this;
      this.setRedraw();
    }
  }

  moveTo(px: number, py: number): void {
    this.x = px;
    this.y = py;
    this.setRedraw();
  }

  // PORT: out-parameters become the result [x, y].
  getPosition(): [number, number] {
    return [this.x, this.y];
  }

  setSize(newWidth: number, newHeight: number): void {
    this.deleteFrame();
    this.width = newWidth;
    this.height = newHeight;
    this.layout();
    this.setRedraw();
  }

  setZoom(newZoom: number): void {
    this.zoom = Math.fround(newZoom);
    this.setRedraw();
  }

  // PORT: out-parameters become the result [width, height].
  getSize(): [number, number] {
    return [this.width, this.height];
  }

  setDisplayed(displayed: boolean): void {
    this.displayed = displayed;
    this.setRedraw();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /* Draw again into new frames, the old ones lost their content (the
     render targets were reset). Children too. */
  invalidate(): void {
    this.deleteFrame();
    this.redraw = true;
    for (const floatWindow of this.floats) {
      floatWindow.invalidate();
    }
  }

  setRedraw(): void {
    this.redraw = true;
    if (this.parent !== null) {
      this.parent.setRedraw();
    }
  }

  isDisplayed(): boolean {
    return this.displayed;
  }

  getParent(): GuiObject | null {
    return this.parent;
  }

  setParent(parent: GuiObject | null): void {
    this.parent = parent;
  }

  pointInside(pointX: number, pointY: number): boolean {
    return (
      pointX >= this.x &&
      pointY >= this.y &&
      pointX < this.x + this.outerWidth() &&
      pointY < this.y + this.outerHeight()
    );
  }

  addFloat(obj: GuiObject, fx: number, fy: number): void {
    obj.setParent(this);
    this.floats.push(obj);
    obj.moveTo(fx, fy);
    this.setRedraw();
  }

  delFloat(obj: GuiObject): void {
    obj.setParent(null);
    this.floats = this.floats.filter((f) => f !== obj);
    this.setRedraw();
  }

  playSound(sound: number): void {
    if (GuiObject.enqueueSfx !== null) {
      GuiObject.enqueueSfx(sound);
    }
  }
}
