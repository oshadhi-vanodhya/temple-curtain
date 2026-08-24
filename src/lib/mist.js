import { PuffField } from "./puffs.js";

/** Spray drifting up from the foot of the painted waterfalls. */
const TAU = Math.PI * 2;

export class Mist {
  /** @param {number} perSource puffs allotted to each waterfall */
  constructor(perSource = 90) {
    this.perSource = perSource;
    this.sources = [];
    this.count = 0;

    this.field = new PuffField({
      // A long, gentle falloff — anything steeper and each puff reads as a
      // distinct blob instead of dissolving into its neighbours.
      stops: [[0, 0.85], [0.25, 0.52], [0.55, 0.2], [0.8, 0.05], [1, 0]],
      color: 0xfffdf7,
      renderOrder: 1,
    });
  }

  get mesh() {
    return this.field.mesh;
  }

  /**
   * @param {Array<{x:number,y:number,spread:number,rise:number,size:number,
   *                intensity:number}>} sources positions already in world space
   */
  layout(sources) {
    this.sources = sources;
    const count = sources.length * this.perSource;

    if (count !== this.count) {
      this.count = count;
      this.#allocate(count);
    }

    // Stagger the initial ages so the plumes are already running on the first
    // frame, instead of every puff being born together in one visible pulse.
    for (let i = 0; i < count; i++) this.#respawn(i, Math.random());
  }

  #allocate(count) {
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.size = new Float32Array(count);
    this.seed = new Float32Array(count);
    this.gain = new Float32Array(count);
    this.src = new Uint8Array(count);
    this.field.resize(count);
  }

  #respawn(i, startAge = 0) {
    const k = Math.floor(i / this.perSource);
    const s = this.sources[k];
    this.src[i] = k;

    this.px[i] = s.x + (Math.random() - 0.5) * s.spread;
    this.py[i] = s.y + (Math.random() - 0.5) * s.spread * 0.5;

    this.vx[i] = (Math.random() - 0.5) * s.rise * 0.35;
    this.vy[i] = s.rise * (0.55 + Math.random() * 0.7);

    this.life[i] = 3.4 + Math.random() * 3.2;
    this.age[i] = startAge * this.life[i];
    this.size[i] = s.size * (0.55 + Math.random() * 0.7);
    this.seed[i] = Math.random() * TAU;
    this.gain[i] = s.intensity * (0.6 + Math.random() * 0.6);
  }

  /** @param {number} dt seconds since the last update */
  update(dt, elapsed) {
    if (!this.count) return;

    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) this.#respawn(i);

      const t = this.age[i] / this.life[i];

      // Rising spray slows as it loses momentum, and wanders sideways.
      this.py[i] += this.vy[i] * (1 - t * 0.65) * dt;
      this.px[i] += (this.vx[i] + Math.sin(elapsed * 0.5 + this.seed[i]) * 0.12) * dt;

      // Fade in briskly, linger, thin out — no puff should pop in or out.
      const fadeIn = Math.min(1, t / 0.18);
      const fadeOut = 1 - Math.max(0, (t - 0.45) / 0.55);
      const alpha = fadeIn * fadeOut * fadeOut * this.gain[i];

      // Spray expands as it disperses, but modestly: a puff that doubles in
      // size reads as one growing blob rather than as dispersing vapour.
      const half = (this.size[i] * (0.6 + t * 0.55)) / 2;
      this.field.set(i, this.px[i], this.py[i], half, half, alpha);
    }

    this.field.flush();
  }

  dispose() {
    this.field.dispose();
  }
}
