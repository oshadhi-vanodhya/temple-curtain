import { PuffField } from "./puffs.js";

/**
 * Slow cloud drifting across the sky.
 *
 * Wisps are far wider than they are tall and much fainter than the waterfall
 * spray — cloud at this distance is a change in the air, not an object. They
 * cross the sky at a crawl and wrap around when they leave the frame.
 *
 * The one thing they must not do is pass over the painted pavilion. The backdrop
 * is a CSS background behind the canvas, so anything drawn here sits *on top* of
 * the gateway's roof; a wisp crossing it would look like fog inside the building
 * rather than behind it. Each wisp is therefore faded out across the roof's span,
 * so cloud dissolves before reaching it and reappears on the far side.
 */
const TAU = Math.PI * 2;

export class Clouds {
  constructor(count = 70) {
    this.count = count;
    this.band = null;

    this.field = new PuffField({
      // Softer even than the spray: a wisp should have no discernible edge.
      stops: [[0, 0.5], [0.3, 0.3], [0.6, 0.12], [0.85, 0.03], [1, 0]],
      color: 0xfffefa,
      renderOrder: 1,
    });

    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.w = new Float32Array(count);
    this.h = new Float32Array(count);
    this.gain = new Float32Array(count);
    this.seed = new Float32Array(count);
  }

  get mesh() {
    return this.field.mesh;
  }

  /**
   * @param {{left:number,right:number,top:number,bottom:number,
   *          maskLeft:number,maskRight:number,maskFade:number,
   *          width:number,height:number,drift:number,intensity:number}} band
   *   all in world space; mask bounds delimit the pavilion the cloud must avoid
   */
  layout(band) {
    this.band = band;
    this.field.resize(this.count);

    for (let i = 0; i < this.count; i++) {
      this.x[i] = band.left + Math.random() * (band.right - band.left);
      this.y[i] = band.bottom + Math.random() * (band.top - band.bottom);
      this.vx[i] = band.drift * (0.55 + Math.random() * 0.9);
      this.w[i] = band.width * (0.55 + Math.random() * 0.9);
      this.h[i] = band.height * (0.5 + Math.random() * 0.9);
      this.gain[i] = band.intensity * (0.45 + Math.random() * 0.85);
      this.seed[i] = Math.random() * TAU;
    }
  }

  /** 0 across the pavilion, easing to 1 clear of it on either side. */
  #mask(x) {
    const b = this.band;
    if (x < b.maskLeft - b.maskFade || x > b.maskRight + b.maskFade) return 1;
    if (x > b.maskLeft && x < b.maskRight) return 0;

    const d = x <= b.maskLeft ? (b.maskLeft - x) / b.maskFade : (x - b.maskRight) / b.maskFade;
    const t = Math.min(1, Math.max(0, d));
    return t * t * (3 - 2 * t);
  }

  update(dt, elapsed) {
    if (!this.band) return;
    const b = this.band;
    const span = b.right - b.left;

    for (let i = 0; i < this.count; i++) {
      this.x[i] += this.vx[i] * dt;
      // Wrap a wisp's whole width past the edge, so none appears mid-air.
      if (this.x[i] - this.w[i] > b.right) this.x[i] -= span + this.w[i] * 2;
      else if (this.x[i] + this.w[i] < b.left) this.x[i] += span + this.w[i] * 2;

      // A slow vertical breathing keeps the sky from looking like a slide.
      const y = this.y[i] + Math.sin(elapsed * 0.06 + this.seed[i]) * b.height * 0.35;

      // Thin out toward the top of the band, where the sky is palest.
      const height = (y - b.bottom) / Math.max(1e-6, b.top - b.bottom);
      const vertical = 1 - Math.max(0, Math.min(1, height)) * 0.45;

      const alpha = this.gain[i] * vertical * this.#mask(this.x[i]);
      this.field.set(i, this.x[i], y, this.w[i] / 2, this.h[i] / 2, alpha);
    }

    this.field.flush();
  }

  dispose() {
    this.field.dispose();
  }
}
