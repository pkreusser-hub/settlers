// video.h + video-sdl.cc - Video rendering.
//
// PORT: the SDL backend is replaced by HTML canvas. The textures of SDL are
// canvases: the screen is the canvas of the page, the frames are
// OffscreenCanvases and the images are canvases made of the RGBA pixels of
// a sprite. The window of SDL is the canvas element: its size on the page
// (set by CSS, not by this code) is the window size, the same in device
// pixels is the render output size. The logical size of SDL (the screen
// texture stretched over the window) is the size of the canvas bitmap,
// which the browser stretches over the element.

import { ExceptionFreeserf, Log } from '../game/misc';

export class ExceptionVideo extends ExceptionFreeserf {
  constructor(description: string) {
    super(description);
  }

  getDescription(): string {
    return '[' + this.getSystem() + ':' + this.getPlatform() + '] ' + this.message;
  }

  getPlatform(): string {
    return 'Canvas';
  }

  getSystem(): string {
    return 'video';
  }
}

export type VideoCanvas = HTMLCanvasElement | OffscreenCanvas;
export type VideoContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface VideoColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export class VideoFrame {
  texture: VideoCanvas | null = null;
  ctx: VideoContext | null = null;
  // The fill colour set on ctx (0xRRGGBB), -1 when unknown.
  fillColor = -1;
}

export class VideoImage {
  w = 0;
  h = 0;
  texture: VideoCanvas | null = null;
}

export class Video {
  static Frame = VideoFrame;
  static Image = VideoImage;

  protected static instance: Video | null = null;
  protected static canvasElement: HTMLCanvasElement | null = null;

  protected canvas: HTMLCanvasElement;
  protected screen: VideoFrame | null = null;
  protected cursor: string | null = null;
  protected zoomFactor = 1;

  // PORT: not in the C++, which creates its window itself. Gives the canvas
  // to draw the screen on; call it before the first use of Video, Graphics
  // or EventLoop. The CSS of the page must give the element its size (for
  // example width: 100vw; height: 100vh): the width and height attributes
  // are set by this class and change with the zoom. Without this call a
  // canvas filling the page is appended to the body.
  static setCanvas(canvas: HTMLCanvasElement): void {
    if (Video.instance !== null) {
      throw new ExceptionVideo('Unable to set the canvas, video is initialized.');
    }
    Video.canvasElement = canvas;
  }

  protected constructor() {
    Log.Info('video', 'Initializing "canvas".');

    /* Create window and renderer */
    let canvas = Video.canvasElement;
    if (canvas === null) {
      canvas = document.createElement('canvas');
      canvas.style.position = 'fixed';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      document.body.appendChild(canvas);
    }
    canvas.style.display = 'block';
    canvas.style.background = '#000';
    canvas.style.imageRendering = 'pixelated';
    this.canvas = canvas;

    const [w, h] = this.getResolution();
    this.setResolution(w, h, false);
  }

  static getInstance(): Video {
    if (Video.instance === null) {
      Video.instance = new Video();
    }
    return Video.instance;
  }

  // PORT: not in the C++. The canvas element of the screen, for the DOM
  // events of the event loop.
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  setResolution(width: number, height: number, fs: boolean): void {
    /* Set fullscreen mode only when it changes: the window may have entered
       or left fullscreen by itself (the maximize button of macOS), and
       setting the old state again would undo that. Fullscreen without a
       display mode is desktop fullscreen. */
    if (fs !== this.isFullscreen()) {
      // PORT: asynchronous in the browser and only allowed from the handler
      // of a key or mouse event. The size of the canvas follows with a
      // resize event.
      try {
        const done = fs ? document.documentElement.requestFullscreen() : document.exitFullscreen();
        done.catch((e) => Log.Warn('video', 'Unable to set window fullscreen', e));
      } catch (e) {
        Log.Warn('video', 'Unable to set window fullscreen', e);
      }
    }

    if (this.screen === null) {
      this.screen = new VideoFrame();
    }

    /* Allocate new screen surface and texture */
    /* Set logical size of screen. */
    // PORT: setting the size of a canvas clears it and resets its context.
    this.canvas.width = Math.max(1, width);
    this.canvas.height = Math.max(1, height);
    if (this.screen.ctx === null) {
      const ctx = this.canvas.getContext('2d');
      if (ctx === null) {
        throw new ExceptionVideo('Unable to create the context of the canvas');
      }
      this.screen.texture = this.canvas;
      this.screen.ctx = ctx;
    }
    this.screen.ctx.imageSmoothingEnabled = false;
    this.screen.fillColor = -1;
  }

  // PORT: out-parameters become the result [width, height].
  getResolution(): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    return [
      Math.max(1, Math.round(rect.width * ratio)),
      Math.max(1, Math.round(rect.height * ratio)),
    ];
  }

  setFullscreen(enable: boolean): void {
    // PORT: the size of the screen is kept here. The C++ sets the size of
    // the window without the zoom and relies on the resize event that
    // follows to apply the zoom again; in the browser that event only comes
    // when the change of the fullscreen mode succeeds.
    this.setResolution(this.canvas.width, this.canvas.height, enable);
  }

  isFullscreen(): boolean {
    return document.fullscreenElement !== null && document.fullscreenElement !== undefined;
  }

  getScreenFrame(): VideoFrame {
    if (this.screen === null) {
      throw new ExceptionVideo('No screen');
    }
    return this.screen;
  }

  createFrame(width: number, height: number): VideoFrame {
    const frame = new VideoFrame();
    this.createTexture(frame, width, height);
    return frame;
  }

  destroyFrame(frame: VideoFrame): void {
    // PORT: the canvas is freed by the garbage collector, its pixels now.
    if (frame.texture !== null && frame.texture !== this.canvas) {
      frame.texture.width = 0;
      frame.texture.height = 0;
    }
    frame.texture = null;
    frame.ctx = null;
  }

  // PORT: data are the RGBA pixels of a sprite (Sprite.data).
  createImage(data: Uint8ClampedArray, width: number, height: number): VideoImage {
    const image = new VideoImage();
    image.w = width;
    image.h = height;
    image.texture = this.createTextureFromData(data, width, height);
    return image;
  }

  destroyImage(image: VideoImage): void {
    if (image.texture !== null) {
      image.texture.width = 0;
      image.texture.height = 0;
    }
    image.texture = null;
  }

  warpMouse(x: number, y: number): void {
    // PORT: a page can not move the mouse pointer.
    void x;
    void y;
  }

  protected createCanvas(width: number, height: number): VideoCanvas {
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  protected createTexture(frame: VideoFrame, width: number, height: number): void {
    const texture = this.createCanvas(width, height);
    const ctx = texture.getContext('2d') as VideoContext | null;
    if (ctx === null) {
      throw new ExceptionVideo('Unable to create canvas');
    }

    /* Keep the pixels sharp when a frame is scaled (zoom, high-DPI
       displays). */
    ctx.imageSmoothingEnabled = false;

    // A new canvas is transparent black, as the texture after
    // SDL_RenderClear.
    frame.texture = texture;
    frame.ctx = ctx;
    frame.fillColor = -1;
  }

  protected createTextureFromData(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): VideoCanvas | null {
    // PORT: a canvas without pixels can not be drawn, such an image has no
    // texture and draws nothing.
    if (width === 0 || height === 0) {
      return null;
    }
    const texture = this.createCanvas(width, height);
    const ctx = texture.getContext('2d') as VideoContext | null;
    if (ctx === null) {
      throw new ExceptionVideo('Unable to create canvas from data');
    }
    ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    return texture;
  }

  drawImage(image: VideoImage, x: number, y: number, yOffset: number, dest: VideoFrame): void {
    if (image.texture === null || dest.ctx === null) return;
    if (image.h - yOffset <= 0) return;

    /* Blit sprite */
    dest.ctx.drawImage(
      image.texture,
      0,
      yOffset,
      image.w,
      image.h - yOffset,
      x,
      y + yOffset,
      image.w,
      image.h - yOffset,
    );
  }

  drawFrame(
    dx: number,
    dy: number,
    dest: VideoFrame,
    sx: number,
    sy: number,
    src: VideoFrame,
    w: number,
    h: number,
  ): void {
    if (dest.ctx === null || src.texture === null) return;
    // PORT: SDL draws nothing for an empty rectangle or texture, the canvas
    // would throw or mirror the picture.
    if (w <= 0 || h <= 0 || src.texture.width === 0 || src.texture.height === 0) return;

    dest.ctx.drawImage(src.texture, sx, sy, w, h, dx, dy, w, h);
  }

  /* Draw all w x h of src scaled to dw x dh at dx, dy. */
  drawFrameScaled(
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    dest: VideoFrame,
    src: VideoFrame,
    w: number,
    h: number,
  ): void {
    if (dest.ctx === null || src.texture === null) return;
    if (w <= 0 || h <= 0 || dw <= 0 || dh <= 0) return;
    if (src.texture.width === 0 || src.texture.height === 0) return;

    dest.ctx.imageSmoothingEnabled = false;
    dest.ctx.drawImage(src.texture, 0, 0, w, h, dx, dy, dw, dh);
  }

  drawRect(
    x: number,
    y: number,
    width: number,
    height: number,
    color: VideoColor,
    dest: VideoFrame,
  ): void {
    /* Draw rectangle. */
    this.fillRect(x, y, width, 1, color, dest);
    this.fillRect(x, y + height - 1, width, 1, color, dest);
    this.fillRect(x, y, 1, height, color, dest);
    this.fillRect(x + width - 1, y, 1, height, color, dest);
  }

  fillRect(
    x: number,
    y: number,
    width: number,
    height: number,
    color: VideoColor,
    dest: VideoFrame,
  ): void {
    const ctx = dest.ctx;
    if (ctx === null) return;

    /* Fill rectangle */
    // The alpha of the color is not used, as in the C++ (0xff).
    const rgb = ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff);
    if (dest.fillColor !== rgb) {
      ctx.fillStyle = '#' + (0x1000000 | rgb).toString(16).substring(1);
      dest.fillColor = rgb;
    }
    // The width and height are unsigned int in the C++.
    ctx.fillRect(x, y, width >>> 0, height >>> 0);
  }

  drawLine(x: number, y: number, x1: number, y1: number, color: VideoColor, dest: VideoFrame): void {
    // PORT: SDL_RenderLine draws the pixels of the line without smoothing,
    // both ends included; the lines of a canvas are smoothed. The pixels
    // are set one by one here (Bresenham).
    if (x === x1) {
      this.fillRect(x, Math.min(y, y1), 1, Math.abs(y1 - y) + 1, color, dest);
      return;
    }
    if (y === y1) {
      this.fillRect(Math.min(x, x1), y, Math.abs(x1 - x) + 1, 1, color, dest);
      return;
    }

    const adx = Math.abs(x1 - x);
    const ady = Math.abs(y1 - y);
    const stepX = x < x1 ? 1 : -1;
    const stepY = y < y1 ? 1 : -1;
    let err = adx - ady;
    for (;;) {
      this.fillRect(x, y, 1, 1, color, dest);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -ady) {
        err -= ady;
        x += stepX;
      }
      if (e2 < adx) {
        err += adx;
        y += stepY;
      }
    }
  }

  swapBuffers(): void {
    // PORT: nothing to do, the screen frame is the canvas of the page and
    // the browser shows it after each animation frame.
  }

  // PORT: data are RGBA pixels (Sprite.data), null for the default cursor.
  setCursor(data: Uint8ClampedArray | null, width: number, height: number): void {
    if (this.cursor !== null) {
      this.canvas.style.cursor = '';
      this.cursor = null;
    }

    if (data === null || width === 0 || height === 0) {
      return;
    }

    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const ctx = surface.getContext('2d');
    if (ctx === null) {
      return;
    }
    ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    this.cursor = 'url(' + surface.toDataURL() + ') 8 8, auto';
    this.canvas.style.cursor = this.cursor;
  }

  getZoomFactor(): number {
    return this.zoomFactor;
  }

  setZoomFactor(factor: number): boolean {
    if (factor < Math.fround(0.1) || factor > 1) {
      return false;
    }

    let [width, height] = this.getResolution();
    this.zoomFactor = Math.fround(factor);

    width = Math.trunc(Math.fround(width * this.zoomFactor));
    height = Math.trunc(Math.fround(height * this.zoomFactor));
    this.setResolution(width, height, this.isFullscreen());

    return true;
  }

  // PORT: out-parameters become the result [fx, fy].
  getScreenFactor(): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const [rw, rh] = this.getResolution();
    const w = rect.width > 0 ? rect.width : rw;
    const h = rect.height > 0 ? rect.height : rh;
    return [Math.fround(rw / w), Math.fround(rh / h)];
  }
}
