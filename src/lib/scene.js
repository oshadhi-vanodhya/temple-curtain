import * as THREE from "three";
import { Cloth } from "./cloth.js";
import { buildGlyphAtlas } from "./glyph-atlas.js";
import { Mist } from "./mist.js";
import { Clouds } from "./clouds.js";

const COLS = 31;
// Rows are set so the inked height of a glyph clears the spacing between them.
// Growing the letters without also opening the rows made ink height and row
// pitch identical, which stacks the text into a solid block.
const ROWS = 36;

const WORLD_HEIGHT = 10;
const BACKDROP_ASPECT = 1700 / 925;

/**
 * The painted gateway's opening, as fractions of the artwork. Re-measured for
 * this backdrop; every value read off the image rather than eyeballed:
 *
 *   - 0.437  underside of the beam. Luminance across the middle of the arch
 *            jumps from 132 to 224 in one row there, which is the edge of the
 *            bracket work against the sky behind it. The curtain starts here and
 *            not above — nothing occludes the cloth, so a strand hung higher
 *            would draw on top of the painted beam.
 *   - 0.923  the foot of the pillar bases, where they meet the paving.
 *   - 0.384 / 0.621  the inner faces of the lacquered shafts. The gold dragon
 *            inlay breaks each shaft into fragments, so these came from a
 *            smoothed red-density profile rather than a solid-colour run.
 */
const GATE = { left: 0.386, right: 0.6185, top: 0.437, bottom: 0.923 };

/**
 * The feet of the painted waterfalls, as fractions of the artwork, where spray
 * should gather. Read off the image: the tall fall on the right runs from y 0.44
 * down to about 0.57, the main left fall from 0.655 to 0.742, and there is a
 * slighter one higher up on the left.
 *
 * `spread` and `size` are fractions of the panel width, so a plume keeps its
 * proportions against the painting at any viewport rather than being fixed in
 * world units and drifting out of scale when the window changes shape.
 */
/**
 * The sky band cloud drifts through, in artwork fractions.
 *
 * `mask*` delimits the painted pavilion, whose dense red spans x 0.306 to 0.694.
 * Cloud has to dissolve before it reaches that: the backdrop is a CSS background
 * behind the canvas, so a wisp drawn over the gateway would read as fog inside
 * the building rather than behind it. The bounds are set wider than the measured
 * roof so the fade completes before the upturned eaves.
 */
const SKY = {
  top: 0.02,
  bottom: 0.46,
  // This backdrop's gateway is wider than the last one's: its roof spans roughly
  // x 0.30 to 0.72, and the eaves reach further still.
  maskLeft: 0.25,
  maskRight: 0.76,
  maskFade: 0.06,
  width: 0.11,
  height: 0.055,
  drift: 0.017,
  // Lower than before. The previous sky was pale cream, where white vapour
  // barely separated; this one is a saturated blue, against which the same
  // white reads immediately and needs far less of it.
  intensity: 0.40,
};


const WATERFALLS = [
  // A single cascade on the left, running x 0.075-0.135 from y 0.56 down to the
  // pool at 0.78. Two sources: spray off the pool, and a lighter veil halfway up.
  { x: 0.105, y: 0.775, spread: 0.030, size: 0.038, rise: 0.30, intensity: 0.24 },
  { x: 0.107, y: 0.660, spread: 0.024, size: 0.030, rise: 0.24, intensity: 0.15 },
];


const CURTAIN_TEXT = "THE STRINGS REMEMBER EVERY HAND THAT HAS PASSED THROUGH THEM ";

const REST_COLOR = new THREE.Color("#241f18");

/**
 * A translucent screen set in the gateway, behind the letters.
 *
 * The backdrop behind the opening is a bright, busy landscape, and small dark
 * glyphs over it lose their edges against the water and the lit sky. The screen
 * gives them a calm ground to sit on. It fills the opening exactly — its edges
 * land on the pillars and the beam — so it reads as a paper screen hung in the
 * gate rather than as a panel floating over the painting, and it is sheer enough
 * that the river and mountains still show through it.
 */
const SCRIM_COLOR = 0xfaf5ea;
const SCRIM_OPACITY = 0.38;
const RING_COLOR = new THREE.Color("#c8922f");

// --- cloth tuning, all expressed against cell size so it survives a resize ---
const GRAVITY_PER_CELL = 0.02;
const DAMPING = 0.99;
const ITERATIONS = 5;
// Strands carry weight, so they may barely stretch but may fold up freely.
const V_COMPRESS = 0.02;
const V_STRETCH = 1.1;
// Neighbours are only loosely tied, which is what lets the sheet gather.
const H_COMPRESS = 0.6;
const H_STRETCH = 4;
// Every vertical link ends up carrying the weight of all the cloth beneath it,
// so after five relaxation passes the sheet settles noticeably longer than its
// cut length — measured at 1.21x, past what the 1.1 stretch limit implies,
// because a slack constraint sharing a pinned partner only closes half its
// error per pass. The sheet is therefore cut short by that same factor so it
// arrives at the intended length once hung. Scale-invariant: gravity is derived
// from cell height, so the ratio holds at any viewport size.
const DRAPE_SLACK = 1.21;

const POINTER_REACH_CELLS = 7;
// Peak shove, as a multiple of gravity. Expressed this way rather than as the
// reference's bare constant because that constant does not survive the change
// of scale — carried across faithfully it moved this sheet by a fifth of a
// pixel. A hanging cloth is taut under its own weight, so a shove has to be
// large against gravity before it reads at all; measured, the response is
// linear. Measured across a sweep: 20x moves the sheet 12px, 45x moves it 40px
// (about three strand widths) and leaves nothing crossed over, 65x reaches 77px
// but leaves strands folded past one another with the text scrambled.
const POINTER_PUSH_GRAVITIES = 45;
const GRAB_RADIUS_CELLS = 2;

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;

const STRIKE_COOLDOWN_MS = 70;
const IDLE_BEFORE_BREEZE_MS = 6500;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The Chinese five-tone scale — gong, shang, jue, zhi, yu — which is what a
 * bianzhong set is actually tuned to. Any two of its notes sound consonant, so a
 * fast sweep across the whole curtain resolves as music rather than a pile-up.
 *
 * The scale is deliberately folded into a fixed span of octaves instead of
 * climbing one strand at a time. A pentatonic rises an octave every five
 * strands, so across thirty-eight of them it reaches nearly eight octaves: the
 * upper strands ran to 47 kHz — silent, and past the Nyquist limit where they
 * alias back down as spurious tones. Mapping strands onto a bounded set of
 * pitches keeps the rise monotonic across the curtain, lets neighbours share a
 * note as a real chime set does, and keeps every strand audible.
 */
function pentatonicOverOctaves(count, root = 293.66, octaves = 3) {
  const steps = [0, 2, 4, 7, 9];
  const distinct = steps.length * octaves;
  const out = [];

  for (let i = 0; i < count; i++) {
    const n = Math.floor((i * distinct) / count);
    const semitone = steps[n % steps.length] + 12 * Math.floor(n / steps.length);
    out.push(root * Math.pow(2, semitone / 12));
  }
  return out;
}

export class TempleStrings {
  constructor(container) {
    this.container = container;
    this.chime = null;
    this.disposed = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    this.camera.position.set(0, 0, 10);

    this.pointer = new THREE.Vector2(0, 0);
    this.pointerActive = false;
    this.lastMoveAt = 0;
    this.grabbed = -1;

    this.cloth = new Cloth(COLS, ROWS);
    this.freqs = pentatonicOverOctaves(COLS);
    // Which side of each strand the pointer was last on, for strike detection.
    this.sides = new Int8Array(COLS);
    this.lastStrike = new Float64Array(COLS);
    this.glow = new Float32Array(COLS);

    this.accumulator = 0;

    this.#buildScrim();
    this.#buildCurtain();
    this.mist = new Mist();
    this.scene.add(this.mist.mesh);
    this.clouds = new Clouds();
    this.scene.add(this.clouds.mesh);
    this.#buildDust();

    this.onResize = this.onResize.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.tick = this.tick.bind(this);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    container.addEventListener("pointermove", this.onPointerMove);
    container.addEventListener("pointerdown", this.onPointerDown);
    container.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("pointerup", this.onPointerUp);

    this.onResize();
    this.startedAt = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  attachAudio(chime) {
    this.chime = chime;
  }

  #buildScrim() {
    this.scrim = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: SCRIM_COLOR,
        transparent: true,
        opacity: SCRIM_OPACITY,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.scrim.renderOrder = 1; // over the backdrop, under the letters
    this.scene.add(this.scrim);
  }

  #buildCurtain() {
    const { canvas, index } = buildGlyphAtlas(CURTAIN_TEXT);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.atlasTexture = texture;

    // Spaces become real gaps in the weave rather than blank quads.
    const cells = [];
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const ch = CURTAIN_TEXT[(row + col * 7) % CURTAIN_TEXT.length];
        const uv = index.get(ch);
        if (uv) cells.push({ col, row, uv });
      }
    }
    this.cells = cells;

    const count = cells.length;
    const positions = new Float32Array(count * 4 * 3);
    const uvs = new Float32Array(count * 4 * 2);
    const colors = new Float32Array(count * 4 * 3);
    const indices = new Uint32Array(count * 6);

    cells.forEach((cell, q) => {
      const { u0, v0, du, dv } = cell.uv;
      const o = q * 8;
      uvs[o] = u0;          uvs[o + 1] = v0;
      uvs[o + 2] = u0 + du; uvs[o + 3] = v0;
      uvs[o + 4] = u0 + du; uvs[o + 5] = v0 + dv;
      uvs[o + 6] = u0;      uvs[o + 7] = v0 + dv;

      const v = q * 4;
      const k = q * 6;
      indices[k] = v;     indices[k + 1] = v + 1; indices[k + 2] = v + 2;
      indices[k + 3] = v; indices[k + 4] = v + 2; indices[k + 5] = v + 3;
    });

    const geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.colAttr = new THREE.BufferAttribute(colors, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute("position", this.posAttr);
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("color", this.colAttr);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    this.curtain = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        vertexColors: true,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.curtain.frustumCulled = false;
    this.curtain.renderOrder = 2;
    this.scene.add(this.curtain);
  }

  #buildDust() {
    const count = 200;
    const positions = new Float32Array(count * 3);
    this.dustSeeds = new Float32Array(count);
    this.dustNorm = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      this.dustNorm[i] = Math.random() - 0.5;
      positions[i * 3] = 0;
      positions[i * 3 + 1] = (Math.random() - 0.5) * WORLD_HEIGHT;
      positions[i * 3 + 2] = -1;
      this.dustSeeds[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    this.dust = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: "#9c8f76",
        size: 0.04,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
      })
    );
    this.dust.renderOrder = 0;
    this.scene.add(this.dust);
  }

  onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.laidOutAt = w * 100000 + h;
    this.renderer.setSize(w, h);

    this.worldWidth = WORLD_HEIGHT * (w / h);

    this.camera.left = -this.worldWidth / 2;
    this.camera.right = this.worldWidth / 2;
    this.camera.top = WORLD_HEIGHT / 2;
    this.camera.bottom = -WORLD_HEIGHT / 2;
    this.camera.updateProjectionMatrix();

    // Mirror CSS `background-size: cover` exactly, so the world knows where the
    // artwork actually landed and the curtain can be pinned to the painted gate.
    const viewAspect = this.worldWidth / WORLD_HEIGHT;
    if (viewAspect > BACKDROP_ASPECT) {
      this.panelWidth = this.worldWidth;
      this.panelHeight = this.worldWidth / BACKDROP_ASPECT;
    } else {
      this.panelHeight = WORLD_HEIGHT;
      this.panelWidth = WORLD_HEIGHT * BACKDROP_ASPECT;
    }

    // The gate's opening, converted from artwork fractions into world space.
    const left = (GATE.left - 0.5) * this.panelWidth;
    const right = (GATE.right - 0.5) * this.panelWidth;
    const top = (0.5 - GATE.top) * this.panelHeight;
    const bottom = (0.5 - GATE.bottom) * this.panelHeight;
    const span = right - left;

    // The screen fills the opening exactly, so its edges meet the architecture.
    this.scrim.scale.set(right - left, top - bottom, 1);
    this.scrim.position.set((left + right) / 2, (top + bottom) / 2, 0);

    this.cellW = span / (COLS - 1);
    this.cellH = (top - bottom) / (ROWS - 1) / DRAPE_SLACK;
    this.glyphSize = this.cellW * 0.98;
    this.clothTop = top;

    this.cloth.drape({
      left,
      top,
      cellW: this.cellW,
      cellH: this.cellH,
      vCompress: V_COMPRESS,
      vStretch: V_STRETCH,
      hCompress: H_COMPRESS,
      hStretch: H_STRETCH,
    });

    this.gravity = GRAVITY_PER_CELL * this.cellH;
    // Held on the instance rather than read from the constant directly, so the
    // shove can be tuned against a live cloth.
    this.pointerStrength = POINTER_PUSH_GRAVITIES;
    this.reachSq = Math.pow(POINTER_REACH_CELLS * this.cellW, 2);
    this.grabRadius = GRAB_RADIUS_CELLS * this.cellW;

    const dustPos = this.dust.geometry.attributes.position;
    for (let i = 0; i < this.dustNorm.length; i++) {
      dustPos.array[i * 3] = this.dustNorm[i] * this.worldWidth;
    }
    dustPos.needsUpdate = true;

    this.clouds.layout({
      left: -this.panelWidth / 2,
      right: this.panelWidth / 2,
      top: (0.5 - SKY.top) * this.panelHeight,
      bottom: (0.5 - SKY.bottom) * this.panelHeight,
      maskLeft: (SKY.maskLeft - 0.5) * this.panelWidth,
      maskRight: (SKY.maskRight - 0.5) * this.panelWidth,
      maskFade: SKY.maskFade * this.panelWidth,
      width: SKY.width * this.panelWidth,
      height: SKY.height * this.panelHeight,
      drift: SKY.drift * this.panelWidth,
      intensity: SKY.intensity,
    });

    // Plumes follow the artwork, so they stay on the falls through any resize.
    this.mist.layout(
      WATERFALLS.map((f) => ({
        x: (f.x - 0.5) * this.panelWidth,
        y: (0.5 - f.y) * this.panelHeight,
        spread: f.spread * this.panelWidth,
        size: f.size * this.panelWidth,
        rise: f.rise * this.panelHeight * 0.1,
        intensity: f.intensity,
      }))
    );
  }

  #toWorld(e) {
    const rect = this.container.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    return [(ndcX * this.worldWidth) / 2, (ndcY * WORLD_HEIGHT) / 2];
  }

  onPointerDown(e) {
    const [x, y] = this.#toWorld(e);
    this.pointer.set(x, y);

    // Grab the nearest particle so the cloth can be taken hold of and dragged.
    const { posX, posY, count } = this.cloth;
    let best = -1;
    let bestDist = this.grabRadius;
    for (let i = 0; i < count; i++) {
      const d = Math.hypot(posX[i] - x, posY[i] - y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) {
      this.grabbed = best;
      this.grabbedWasPinned = this.cloth.pinned[best];
      this.cloth.pinned[best] = 1;
    }
  }

  onPointerUp() {
    if (this.grabbed >= 0) {
      this.cloth.pinned[this.grabbed] = this.grabbedWasPinned;
      this.grabbed = -1;
    }
  }

  onPointerMove(e) {
    const [x, y] = this.#toWorld(e);

    if (!this.pointerActive) {
      // Entering fresh: forget which side of each strand we were on, so
      // re-entry doesn't read as having crossed everything in between.
      this.sides.fill(0);
      this.pointerActive = true;
    }

    this.pointer.set(x, y);
    this.lastMoveAt = performance.now();

    const cloth = this.cloth;

    if (this.grabbed >= 0) {
      // Move it *and* its previous position, or verlet reads the jump as speed.
      cloth.posX[this.grabbed] = x;
      cloth.posY[this.grabbed] = y;
      cloth.oldX[this.grabbed] = x;
      cloth.oldY[this.grabbed] = y;
    }

    this.#pushAside(x, y);
    this.#detectCrossings();
  }

  onPointerLeave() {
    this.pointerActive = false;
    this.sides.fill(0);
  }

  /**
   * A radial shove away from the pointer, falling off with squared distance.
   *
   * There is no separate notion of wind any more: the cloth's own structure
   * carries the motion. Shoving a handful of particles aside drags their
   * neighbours along through the horizontal links, so the disturbance spreads
   * across the sheet and down each strand on its own.
   */
  #pushAside(mx, my) {
    const { posX, posY, count } = this.cloth;
    const reachSq = this.reachSq;
    const strength = this.pointerStrength * this.gravity;

    for (let i = 0; i < count; i++) {
      const dx = mx - posX[i];
      const dy = my - posY[i];
      const distSq = dx * dx + dy * dy;
      if (distSq >= reachSq) continue;

      const falloff = smoothstep(reachSq, -0.4 * reachSq, distSq);
      const dist = Math.sqrt(distSq) || 1e-6;
      const push = falloff * strength;

      // Away from the pointer.
      this.cloth.applyForce(i, (-dx / dist) * push, (-dy / dist) * push);
    }
  }

  /**
   * A strand rings when the pointer changes which side of it it is on. With the
   * cloth free to move in two dimensions a strand is no longer a straight
   * column, so the comparison is made against whichever of its particles is
   * currently level with the pointer.
   */
  #detectCrossings() {
    const { posX, posY } = this.cloth;
    const now = performance.now();
    const yTolerance = this.cellH * 2.5;

    for (let col = 0; col < COLS; col++) {
      let nearest = -1;
      let nearestDy = Infinity;
      for (let row = 0; row < ROWS; row++) {
        const i = this.cloth.index(col, row);
        const dy = Math.abs(posY[i] - this.pointer.y);
        if (dy < nearestDy) {
          nearestDy = dy;
          nearest = i;
        }
      }
      if (nearest < 0 || nearestDy > yTolerance) {
        this.sides[col] = 0;
        continue;
      }

      // Two-state, never zero: a pointer exactly on a strand would otherwise
      // drop both the arriving and the departing sample and swallow the cross.
      const side = this.pointer.x - posX[nearest] >= 0 ? 1 : -1;
      const prev = this.sides[col];
      this.sides[col] = side;

      if (prev === 0 || prev === side) continue;
      if (now - this.lastStrike[col] < STRIKE_COOLDOWN_MS) continue;

      this.lastStrike[col] = now;
      this.glow[col] = 1;

      if (this.chime) {
        const pan = this.worldWidth ? (posX[nearest] / (this.worldWidth / 2)) * 0.7 : 0;
        this.chime.strike(this.freqs[col], 0.75, pan);
      }
    }
  }

  #breeze(now) {
    if (!this.chime || now - this.lastMoveAt < IDLE_BEFORE_BREEZE_MS) return;
    if (Math.random() > 0.004) return;

    const col = Math.floor(Math.random() * COLS);
    if (now - this.lastStrike[col] < 1200) return;
    this.lastStrike[col] = now;
    this.glow[col] = 0.5;

    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let row = 1; row < ROWS; row++) {
      const i = this.cloth.index(col, row);
      this.cloth.applyForce(i, dir * this.cellW * 0.004 * (row / ROWS), 0);
    }
    const pan = (this.cloth.posX[this.cloth.index(col, 1)] / (this.worldWidth / 2)) * 0.7;
    this.chime.strike(this.freqs[col], 0.16, pan);
  }

  /** Rewrite every glyph quad from the cloth's current shape. */
  #updateCurtain() {
    const { posX, posY, oldX, oldY } = this.cloth;
    const pos = this.posAttr.array;
    const col3 = this.colAttr.array;
    const half = this.glyphSize / 2;
    const tint = new THREE.Color();

    // Motion lights a strand, so the sheet warms where it is actually moving.
    for (let c = 0; c < COLS; c++) {
      let speed = 0;
      for (let r = 1; r < ROWS; r++) {
        const i = this.cloth.index(c, r);
        speed += Math.abs(posX[i] - oldX[i]) + Math.abs(posY[i] - oldY[i]);
      }
      speed /= ROWS;
      const moving = Math.min(1, speed / (this.cellW * 0.06));
      this.glow[c] = Math.max(moving, this.glow[c] * 0.94);
    }

    for (let q = 0; q < this.cells.length; q++) {
      const cell = this.cells[q];
      const i = this.cloth.index(cell.col, cell.row);
      const cx = posX[i];
      const cy = posY[i];

      // Each letter lies along its strand, so the text bends with the fold.
      let dx;
      let dy;
      if (cell.row < ROWS - 1) {
        const below = this.cloth.index(cell.col, cell.row + 1);
        dx = posX[below] - cx;
        dy = posY[below] - cy;
      } else {
        const above = this.cloth.index(cell.col, cell.row - 1);
        dx = cx - posX[above];
        dy = cy - posY[above];
      }
      const angle = Math.atan2(dy, dx) + Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const hx = half * cos;
      const hy = half * sin;
      const vx = -half * sin;
      const vy = half * cos;

      const o = q * 12;
      pos[o]     = cx - hx - vx; pos[o + 1]  = cy - hy - vy; pos[o + 2]  = 0;
      pos[o + 3] = cx + hx - vx; pos[o + 4]  = cy + hy - vy; pos[o + 5]  = 0;
      pos[o + 6] = cx + hx + vx; pos[o + 7]  = cy + hy + vy; pos[o + 8]  = 0;
      pos[o + 9] = cx - hx + vx; pos[o + 10] = cy - hy + vy; pos[o + 11] = 0;

      tint.copy(REST_COLOR).lerp(RING_COLOR, this.glow[cell.col]);
      const cbase = q * 12;
      for (let v = 0; v < 4; v++) {
        col3[cbase + v * 3] = tint.r;
        col3[cbase + v * 3 + 1] = tint.g;
        col3[cbase + v * 3 + 2] = tint.b;
      }
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  tick() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    if (cw && ch && cw * 100000 + ch !== this.laidOutAt) this.onResize();

    const now = performance.now();
    const elapsed = (now - this.startedAt) / 1000;
    const frameMs = this.lastFrameAt ? now - this.lastFrameAt : STEP_MS;
    this.lastFrameAt = now;

    this.#breeze(now);

    // Fixed steps, so the drape is the same on a 144Hz display as on a 60Hz one.
    this.accumulator = Math.min(this.accumulator + frameMs, STEP_MS * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= STEP_MS) {
      this.cloth.step(this.gravity, DAMPING, ITERATIONS);
      this.accumulator -= STEP_MS;
    }

    this.#updateCurtain();
    const vaporDt = Math.min(frameMs, 100) / 1000;
    this.mist.update(vaporDt, elapsed);
    this.clouds.update(vaporDt, elapsed);

    const dustPos = this.dust.geometry.attributes.position;
    for (let i = 0; i < this.dustSeeds.length; i++) {
      const seed = this.dustSeeds[i];
      dustPos.array[i * 3] += Math.sin(elapsed * 0.12 + seed) * 0.0009;
      dustPos.array[i * 3 + 1] += 0.0016 + Math.cos(elapsed * 0.09 + seed) * 0.0006;
      if (dustPos.array[i * 3 + 1] > WORLD_HEIGHT / 2) {
        dustPos.array[i * 3 + 1] = -WORLD_HEIGHT / 2;
      }
    }
    dustPos.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);

    this.resizeObserver.disconnect();
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("pointerup", this.onPointerUp);

    this.scrim.geometry.dispose();
    this.scrim.material.dispose();

    this.curtain.geometry.dispose();
    this.curtain.material.dispose();
    this.atlasTexture.dispose();

    this.mist.dispose();
    this.clouds.dispose();

    this.dust.geometry.dispose();
    this.dust.material.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
