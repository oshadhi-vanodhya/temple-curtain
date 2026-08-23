/**
 * A verlet cloth: a grid of particles held together by distance constraints and
 * pinned along its top row.
 *
 * This replaces an earlier 1D model where each strand stored only a lateral
 * displacement. That could ripple but it could never behave as cloth: a strand
 * could not gather, fold, swing on its own hinge, or hang under its own weight,
 * because there was no second dimension for it to do any of that in. Here every
 * particle moves freely in the plane and the sheet's shape is whatever the
 * constraints and gravity settle on.
 *
 * Two families of constraint, and the difference between them is what makes it
 * read as a curtain rather than a net:
 *
 *   - Vertical, down each strand: barely allowed to stretch, free to compress.
 *     These carry the weight.
 *   - Horizontal, between neighbouring strands: loose in both directions.
 *     They let strands drift apart and bunch together while still dragging on
 *     one another, which is what gives the sheet its cohesion.
 *
 * Constraints are *slack*: they only pull when a link is shorter than its
 * minimum or longer than its maximum, and do nothing in between. A cloth of
 * stiff exact-length links behaves like a screen door.
 *
 * State is kept in flat typed arrays rather than particle objects — with a few
 * thousand particles resolved five times a frame, the indirection of an object
 * graph is the whole cost.
 */
export class Cloth {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;

    const n = cols * rows;
    this.count = n;

    this.posX = new Float32Array(n);
    this.posY = new Float32Array(n);
    this.oldX = new Float32Array(n);
    this.oldY = new Float32Array(n);
    this.accX = new Float32Array(n);
    this.accY = new Float32Array(n);
    this.pinned = new Uint8Array(n);

    const vertical = cols * (rows - 1);
    const horizontal = (cols - 1) * rows;
    const m = vertical + horizontal;

    this.ca = new Uint32Array(m);
    this.cb = new Uint32Array(m);
    this.cMin = new Float32Array(m);
    this.cMax = new Float32Array(m);
    this.isSpacer = new Uint8Array(m);
    this.linkCount = m;

    // Topology never changes; only the rest lengths are recomputed on resize.
    let k = 0;
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows - 1; row++) {
        this.ca[k] = this.index(col, row);
        this.cb[k] = this.index(col, row + 1);
        k++;
      }
    }
    for (let col = 0; col < cols - 1; col++) {
      for (let row = 0; row < rows; row++) {
        this.ca[k] = this.index(col, row);
        this.cb[k] = this.index(col + 1, row);
        this.isSpacer[k] = 1;
        k++;
      }
    }
    this.verticalLinks = vertical;
  }

  index(col, row) {
    return col * this.rows + row;
  }

  /** Hang a fresh sheet on the given grid and recompute every rest length. */
  drape({ left, top, cellW, cellH, vCompress, vStretch, hCompress, hStretch }) {
    this.cellW = cellW;
    this.cellH = cellH;

    for (let col = 0; col < this.cols; col++) {
      for (let row = 0; row < this.rows; row++) {
        const i = this.index(col, row);
        const x = left + col * cellW;
        const y = top - row * cellH;
        this.posX[i] = this.oldX[i] = x;
        this.posY[i] = this.oldY[i] = y;
        this.accX[i] = this.accY[i] = 0;
        this.pinned[i] = row === 0 ? 1 : 0; // the top row hangs from the beam
      }
    }

    for (let k = 0; k < this.linkCount; k++) {
      const spacer = this.isSpacer[k];
      const rest = spacer ? cellW : cellH;
      this.cMin[k] = rest * (spacer ? hCompress : vCompress);
      this.cMax[k] = rest * (spacer ? hStretch : vStretch);
    }
  }

  applyForce(i, fx, fy) {
    this.accX[i] += fx;
    this.accY[i] += fy;
  }

  step(gravity, damping, iterations) {
    const { posX, posY, oldX, oldY, accX, accY, pinned, count } = this;

    for (let i = 0; i < count; i++) {
      if (pinned[i]) {
        accX[i] = 0;
        accY[i] = 0;
        continue;
      }
      // Verlet: velocity is implied by the gap between this position and the
      // last one, so a positional correction from a constraint is itself felt
      // as motion on the following step.
      const vx = (posX[i] - oldX[i]) * damping;
      const vy = (posY[i] - oldY[i]) * damping;

      oldX[i] = posX[i];
      oldY[i] = posY[i];

      posX[i] += vx + accX[i];
      posY[i] += vy + accY[i] - gravity;

      accX[i] = 0;
      accY[i] = 0;
    }

    // Gauss-Seidel: each pass uses the previous pass's corrections, so a few
    // cheap sweeps converge far better than one expensive exact solve.
    for (let pass = 0; pass < iterations; pass++) this.#relax();
  }

  #relax() {
    const { ca, cb, cMin, cMax, posX, posY, pinned, linkCount } = this;

    for (let k = 0; k < linkCount; k++) {
      const a = ca[k];
      const b = cb[k];

      const dx = posX[b] - posX[a];
      const dy = posY[b] - posY[a];
      const dist = Math.hypot(dx, dy);
      if (dist === 0) continue;

      // Inside the slack band the link is ignored entirely.
      let target;
      if (dist < cMin[k]) target = cMin[k];
      else if (dist > cMax[k]) target = cMax[k];
      else continue;

      const percent = (target - dist) / dist / 2;
      const ox = dx * percent;
      const oy = dy * percent;

      if (!pinned[a]) {
        posX[a] -= ox;
        posY[a] -= oy;
      }
      if (!pinned[b]) {
        posX[b] += ox;
        posY[b] += oy;
      }
    }
  }
}
