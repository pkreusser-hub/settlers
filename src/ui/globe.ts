// The "Globe" mode of the map view: the finished flat picture of the map is
// put on the screen as the near side of a small planet.
//
// PORT: not in the C++.
//
// Two coordinate systems, both in pixels of the map (not device pixels):
//
//   flat (u, v)  the picture the view draws (Viewport.frame), flatWidth x
//                flatHeight. It is wider and taller than the screen.
//   view (x, y)  the place on the screen, width x height.
//
// The lower part of the screen (below y0) shows the flat picture 1:1. Above
// it the rows of the picture lie on a sphere seen from the side: a row at
// the arc length a above y0 has the angle t = a / R, is drawn at the height
// R sin(t) above y0 and is narrowed around the middle of the screen by
// k(t) = cos(t) ^ P. The rows end at t = 90 degrees, the horizon,
// R above y0. A row of the picture stays a row of the screen, so the
// picture can be drawn in horizontal strips, and both directions have a
// closed form:
//
//   forward   t = (v0 - v) / R
//             x = cx + (u - cu) k(t)        y = y0 - R sin(t)
//   inverse   t = asin((y0 - y) / R)
//             u = cu + (x - cx) / k(t)      v = v0 - R t
//
// with cx, cu the middle of the screen and of the picture and v0 the row
// of the picture drawn at y0. Below y0: u = x + pad, v = y - y0 + v0.

/* The part of the height of the view, from the bottom, that stays flat. */
export const GLOBE_FLAT = 0.42;
/* The part of the height of the view above the top of the planet. */
export const GLOBE_HORIZON = 0.09;
/* P above: 0 gives a cylinder with a straight horizon, 1 a sphere, whose
   rows run into one point at the top. In between the horizon is a flatter
   arc and the rows keep more of their width. */
export const GLOBE_ROUND = 0.6;
/* The width of the planet where the curve begins, in widths of the view.
   Above 1 the sides of the planet are outside of the screen there and the
   horizon meets the edges of the screen at an angle. */
export const GLOBE_WIDE = 1.3;

const HALF_PI = Math.PI / 2;

/* One strip of the curved part: the rows v .. v + h of the flat picture go
   to one row of device pixels, from x over w device pixels. */
export interface GlobeStrips {
  /* The first row of device pixels and the row after the last. */
  top: number;
  bottom: number;
  /* Per row: v, h (pixels of the flat picture), x, w (device pixels) and
     the height of a pixel of the picture there, in device pixels. */
  v: Float64Array;
  h: Float64Array;
  x: Float64Array;
  w: Float64Array;
  size: Float64Array;
}

export class Globe {
  readonly width: number;
  readonly height: number;
  readonly flatWidth: number;
  readonly flatHeight: number;
  /* The columns of the flat picture left of the view in the flat part. */
  readonly pad: number;
  /* The row of the view where the curve begins and the row of the flat
     picture drawn there. */
  readonly y0: number;
  readonly v0: number;
  /* The radius, and the row of the view of the top of the planet. */
  readonly radius: number;
  readonly yTop: number;

  protected cx: number;
  protected cu: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    /* A multiple of 4, so that y0 is on a whole device pixel at every
       scale of the map (the smallest step of the scales is a quarter). */
    this.y0 = Math.max(4, 4 * Math.round(((1 - GLOBE_FLAT) * height) / 4));
    this.yTop = Math.min(this.y0 - 4, GLOBE_HORIZON * height);
    this.radius = this.y0 - this.yTop;
    this.v0 = Math.ceil(this.radius * HALF_PI);
    this.pad = Math.ceil((width * (GLOBE_WIDE - 1)) / 2);
    this.flatWidth = width + 2 * this.pad;
    this.flatHeight = this.v0 + (height - this.y0);
    this.cx = width / 2;
    this.cu = this.flatWidth / 2;
  }

  protected narrow(t: number): number {
    return Math.pow(Math.max(0, Math.cos(t)), GLOBE_ROUND);
  }

  /* The place on the screen of the point u, v of the flat picture; null
     behind the horizon. */
  forward(u: number, v: number): [number, number] | null {
    if (v >= this.v0) {
      return [u - this.pad, v - this.v0 + this.y0];
    }
    const t = (this.v0 - v) / this.radius;
    if (t > HALF_PI) return null;
    return [this.cx + (u - this.cu) * this.narrow(t), this.y0 - this.radius * Math.sin(t)];
  }

  /* The point of the flat picture shown at x, y of the screen; null in the
     sky. */
  inverse(x: number, y: number): [number, number] | null {
    if (y >= this.y0) {
      return [x + this.pad, y - this.y0 + this.v0];
    }
    const q = (this.y0 - y) / this.radius;
    if (q > 1) return null;
    const t = Math.asin(q);
    const k = this.narrow(t);
    if (k < 1e-9) return null;
    const u = this.cu + (x - this.cx) / k;
    if (u < 0 || u >= this.flatWidth) return null;
    return [u, this.v0 - this.radius * t];
  }

  /* The left edge of the planet on the screen at the row y above y0 (the
     right edge mirrors it); null above the planet. */
  edge(y: number): number | null {
    const q = (this.y0 - y) / this.radius;
    if (q > 1) return null;
    return this.cx - this.cu * this.narrow(Math.asin(Math.max(0, q)));
  }

  /* The strips of the curved part for a screen with pixelSize device
     pixels per pixel of the map. */
  strips(pixelSize: number): GlobeStrips {
    const bottom = Math.round(this.y0 * pixelSize);
    const top = Math.max(0, Math.floor(this.yTop * pixelSize));
    const n = Math.max(0, bottom - top);
    const result: GlobeStrips = {
      top,
      bottom,
      v: new Float64Array(n),
      h: new Float64Array(n),
      x: new Float64Array(n),
      w: new Float64Array(n),
      size: new Float64Array(n),
    };
    const angle = (y: number): number =>
      Math.asin(Math.min(1, Math.max(0, (this.y0 - y) / this.radius)));
    for (let i = 0; i < n; i++) {
      const d = top + i;
      const tUp = angle(d / pixelSize);
      const tDown = angle((d + 1) / pixelSize);
      const tMid = angle((d + 0.5) / pixelSize);
      const k = this.narrow(tMid);
      result.v[i] = this.v0 - this.radius * tUp;
      result.h[i] = this.radius * (tUp - tDown);
      result.x[i] = (this.cx - this.cu * k) * pixelSize;
      result.w[i] = this.flatWidth * k * pixelSize;
      result.size[i] = result.h[i] > 0 ? 1 / result.h[i] : 0;
    }
    return result;
  }
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/* The outline of the planet above y0 in device pixels, as a path from the
   left end over the top to the right end. */
function outline(ctx: Context, globe: Globe, pixelSize: number): void {
  const steps = 96;
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const y = globe.y0 - globe.radius * Math.sin((HALF_PI * i) / steps);
    points.push([(globe.edge(y) as number) * pixelSize, y * pixelSize]);
  }
  const mirror = globe.width * pixelSize;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points) ctx.lineTo(x, y);
  for (let i = steps; i >= 0; i--) ctx.lineTo(mirror - points[i][0], points[i][1]);
}

/* Paint the sky behind the planet on the w x h device pixels of ctx (the
   part of the screen above y0): space, a few stars and the glow of the air
   along the horizon. */
export function paintGlobeSky(ctx: Context, globe: Globe, pixelSize: number, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#02030a');
  sky.addColorStop(0.5, '#060b1c');
  sky.addColorStop(1, '#0d1a36');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  /* Stars: always the same ones, by a fixed sequence. */
  let seed = 0x2f6e2b1;
  const next = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const dot = Math.max(1, Math.round(pixelSize / 2));
  const count = Math.round((w * h) / 9000);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(next() * w);
    const y = Math.floor(next() * h);
    const light = 0.25 + 0.6 * next();
    ctx.fillStyle = `rgba(215, 226, 255, ${light.toFixed(2)})`;
    ctx.fillRect(x, y, dot, dot);
  }

  /* The air: wide and faint, then narrow and bright. The planet covers
     the inner half of the lines. */
  const unit = Math.max(1, (globe.height * pixelSize) / 540);
  ctx.lineJoin = 'round';
  outline(ctx, globe, pixelSize);
  for (const [width, alpha] of [[34, 0.05], [22, 0.07], [13, 0.1], [7, 0.16], [3, 0.4]]) {
    ctx.lineWidth = width * unit;
    ctx.strokeStyle = `rgba(120, 180, 255, ${alpha})`;
    ctx.stroke();
  }
}

/* Paint the haze over the far land on ctx (transparent elsewhere): the
   land fades into the colour of the air towards the horizon. */
export function paintGlobeHaze(ctx: Context, globe: Globe, pixelSize: number, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  outline(ctx, globe, pixelSize);
  ctx.clip();
  const top = globe.yTop * pixelSize;
  const haze = ctx.createLinearGradient(0, top, 0, top + 0.6 * globe.radius * pixelSize);
  haze.addColorStop(0, 'rgba(150, 195, 255, 0.55)');
  haze.addColorStop(0.25, 'rgba(140, 188, 255, 0.22)');
  haze.addColorStop(1, 'rgba(130, 180, 255, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
