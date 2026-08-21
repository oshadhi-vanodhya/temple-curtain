/**
 * A taut string, pinned at both ends.
 *
 * Rather than simulating each node as a free 2D particle, this solves the 1D
 * wave equation along the string's length: every node stores only its lateral
 * displacement `u`. That is both far more stable than free verlet particles and
 * physically truer — you get real waves that travel to the anchors, reflect,
 * and interfere on the way back, which is what makes a plucked string read as
 * a string rather than as a wobbling rope.
 *
 *   u[i]" = c^2 * (u[i-1] - 2u[i] + u[i+1])
 *
 * `c` is held below 1 to satisfy the Courant stability condition.
 */
export class VibratingString {
  constructor({ x, z = 0, top, bottom, nodes = 48, speed = 0.34, damping = 0.996, freq = 440, maxAmplitude = 0.3, freeEnd = false }) {
    this.x = x;
    this.z = z;
    this.top = top;
    this.bottom = bottom;
    this.freq = freq;
    this.nodes = nodes;
    this.speed = speed;
    this.damping = damping;
    // Hard ceiling on lateral travel. Neighbouring strings sit ~0.83 world
    // units apart, so capping each at 0.3 leaves clear air between two strings
    // swinging toward each other — without it, a frantic sweep piles up enough
    // amplitude for them to visibly cross.
    this.maxAmplitude = maxAmplitude;

    // A curtain strand hangs loose at the bottom. Clamping both ends (a harp
    // string) kills the sway entirely, so the free end gets a Neumann boundary
    // instead of a fixed one: the last node simply copies its neighbour, which
    // lets the tail swing sideways rather than being held at zero.
    this.freeEnd = freeEnd;

    this.u = new Float32Array(nodes);
    this.uPrev = new Float32Array(nodes);
    this.uNext = new Float32Array(nodes);

    this.energy = 0;
    // Guards against one frantic pointer sweep machine-gunning the same string.
    this.lastStrike = -1;
  }

  /** Node index nearest a world-space y, or -1 if y is off the string. */
  indexAtY(y) {
    const t = (this.top - y) / (this.top - this.bottom);
    if (t < 0 || t > 1) return -1;
    return Math.round(t * (this.nodes - 1));
  }

  /** Current lateral displacement at a world-space y, linearly interpolated. */
  displacementAtY(y) {
    const t = (this.top - y) / (this.top - this.bottom);
    if (t < 0 || t > 1) return null;

    const f = t * (this.nodes - 1);
    const i = Math.floor(f);
    const frac = f - i;
    if (i >= this.nodes - 1) return this.u[this.nodes - 1];
    return this.u[i] * (1 - frac) + this.u[i + 1] * frac;
  }

  /**
   * Displace the string around a node with a smooth bell, so the pluck injects
   * a rounded pulse instead of a single-sample spike that would read as a click.
   */
  pluck(index, amount, width = 4) {
    const lastMovable = this.freeEnd ? this.nodes - 1 : this.nodes - 2;
    if (index < 1 || index > lastMovable) return;

    // An already-taut string resists further displacement, so repeated strikes
    // ring it brighter rather than pushing it ever wider.
    const slack = 1 - Math.min(1, Math.abs(this.u[index]) / this.maxAmplitude);
    const scaled = amount * (0.25 + 0.75 * slack);

    for (let o = -width; o <= width; o++) {
      const i = index + o;
      if (i < 1 || i > lastMovable) continue;
      const falloff = 0.5 * (1 + Math.cos((Math.PI * o) / (width + 1)));
      this.u[i] += scaled * falloff;
    }
  }

  step() {
    const { u, uPrev, uNext, nodes, damping } = this;
    const c2 = this.speed * this.speed;
    const max = this.maxAmplitude;

    // The top stays pinned to the roof beam — that boundary reflects the wave.
    uNext[0] = 0;

    let energy = 0;
    for (let i = 1; i < nodes - 1; i++) {
      const accel = c2 * (u[i - 1] - 2 * u[i] + u[i + 1]);
      let next = (2 * u[i] - uPrev[i] + accel) * damping;
      // Safety net, so no accumulation path can push strings into each other.
      if (next > max) next = max;
      else if (next < -max) next = -max;
      uNext[i] = next;
      energy += Math.abs(next - u[i]);
    }

    // Resolve the bottom boundary after the interior, since the free case reads
    // the neighbour's freshly computed value.
    uNext[nodes - 1] = this.freeEnd ? uNext[nodes - 2] : 0;

    // Rotate the three buffers instead of allocating new ones each frame.
    this.uPrev = u;
    this.u = uNext;
    this.uNext = uPrev;

    this.energy = energy / nodes;
  }
}
