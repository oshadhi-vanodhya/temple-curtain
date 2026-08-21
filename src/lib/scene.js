import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { VibratingString } from "./string-sim.js";

const STRING_COUNT = 19;
const NODES = 40;

const WORLD_HEIGHT = 10;
const STRING_TOP = 4.15;
const STRING_BOTTOM = -4.15;

const REST_COLOR = new THREE.Color("#4a4235");
const RING_COLOR = new THREE.Color("#c8922f");

const STRIKE_COOLDOWN_MS = 70;
const IDLE_BEFORE_BREEZE_MS = 6500;

/**
 * A minor-pentatonic run. Any two strings in this set sound consonant together,
 * so a fast sweep across the whole array still resolves as music rather than
 * as a pile-up — which matters when the interaction is "drag your hand across
 * everything at once".
 */
function pentatonic(count, root = 293.66) {
  const steps = [0, 3, 5, 7, 10];
  const out = [];
  for (let i = 0; i < count; i++) {
    const semitone = steps[i % steps.length] + 12 * Math.floor(i / steps.length);
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
    this.prevPointer = new THREE.Vector2(0, 0);
    this.pointerActive = false;
    this.pointerSpeed = 0;
    this.lastMoveAt = 0;

    this.strings = [];
    this.lines = [];
    this.materials = [];
    this.scratch = new Float32Array(NODES * 3);

    this.#buildStrings();
    this.#buildDust();

    this.onResize = this.onResize.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.tick = this.tick.bind(this);

    window.addEventListener("resize", this.onResize);
    container.addEventListener("pointermove", this.onPointerMove);
    container.addEventListener("pointerleave", this.onPointerLeave);

    this.onResize();
    this.startedAt = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  attachAudio(chime) {
    this.chime = chime;
  }

  #buildStrings() {
    const freqs = pentatonic(STRING_COUNT);

    for (let i = 0; i < STRING_COUNT; i++) {
      const t = STRING_COUNT === 1 ? 0.5 : i / (STRING_COUNT - 1);

      const sim = new VibratingString({
        x: 0, // real x is assigned in layout(), which depends on viewport width
        z: (i % 3) * 0.01,
        top: STRING_TOP,
        bottom: STRING_BOTTOM,
        nodes: NODES,
        // Shorter/brighter strings settle faster, mirroring their pitch.
        speed: 0.3 + t * 0.1,
        damping: 0.9975 - t * 0.0012,
        freq: freqs[i],
      });
      sim.slot = t;
      this.strings.push(sim);

      const geometry = new LineGeometry();
      geometry.setPositions(new Array(NODES * 3).fill(0));

      const material = new LineMaterial({
        color: REST_COLOR.clone(),
        linewidth: 1.6 + (1 - t) * 1.1,
        transparent: true,
        opacity: 0.85,
      });

      const line = new Line2(geometry, material);
      line.frustumCulled = false;

      this.scene.add(line);
      this.lines.push(line);
      this.materials.push(material);
    }
  }

  /** Slow drifting motes — the light-in-a-dusty-hall cue. */
  #buildDust() {
    const count = 220;
    const positions = new Float32Array(count * 3);
    this.dustSeeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 1] = (Math.random() - 0.5) * WORLD_HEIGHT;
      positions[i * 3 + 2] = -1 - Math.random() * 2;
      this.dustSeeds[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    this.dust = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: "#9c8f76",
        size: 0.045,
        transparent: true,
        opacity: 0.5,
        sizeAttenuation: true,
      })
    );
    this.scene.add(this.dust);
  }

  onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.renderer.setSize(w, h);

    const aspect = w / h;
    this.worldWidth = WORLD_HEIGHT * aspect;

    this.camera.left = -this.worldWidth / 2;
    this.camera.right = this.worldWidth / 2;
    this.camera.top = WORLD_HEIGHT / 2;
    this.camera.bottom = -WORLD_HEIGHT / 2;
    this.camera.updateProjectionMatrix();

    for (const m of this.materials) m.resolution.set(w, h);

    // Keep the array comfortably inside the viewport on any aspect ratio.
    const span = Math.min(this.worldWidth * 0.84, 15);
    const gap = span / (STRING_COUNT - 1);
    for (const s of this.strings) {
      s.x = -span / 2 + s.slot * span;
      // Spacing changes with the viewport, so the travel ceiling has to follow
      // it — 36% of the gap keeps two strings swinging together clear of each
      // other at any window size.
      s.maxAmplitude = gap * 0.36;
    }
  }

  onPointerMove(e) {
    const rect = this.container.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    const x = (ndcX * this.worldWidth) / 2;
    const y = (ndcY * WORLD_HEIGHT) / 2;

    if (!this.pointerActive) {
      // First sample after entering: seed both points so we don't register a
      // bogus crossing of every string between the last exit and here.
      this.prevPointer.set(x, y);
      this.pointerActive = true;
    } else {
      this.prevPointer.copy(this.pointer);
    }

    this.pointer.set(x, y);
    this.pointerSpeed = this.pointer.distanceTo(this.prevPointer);
    this.lastMoveAt = performance.now();

    this.#detectCrossings();
  }

  onPointerLeave() {
    this.pointerActive = false;
    this.pointerSpeed = 0;
  }

  /**
   * A string is "touched" when the pointer changes which side of it it is on
   * between two frames. Comparing sides rather than measuring distance means a
   * fast flick still registers every string it passed through, instead of
   * skipping the ones that fell between two samples.
   */
  #detectCrossings() {
    if (!this.pointerActive) return;
    const now = performance.now();

    for (const s of this.strings) {
      const disp = s.displacementAtY(this.pointer.y);
      if (disp === null) continue; // pointer is above or below this string

      const surfaceX = s.x + disp;
      // Deliberately a two-state side with no zero: Math.sign() would report 0
      // for a pointer sitting exactly on the string, and skipping that sample
      // plus the next one would swallow the crossing entirely. Landing exactly
      // on a string counts as the positive side.
      const side = this.pointer.x - surfaceX >= 0 ? 1 : -1;
      const prevSide = this.prevPointer.x - surfaceX >= 0 ? 1 : -1;

      if (side === prevSide) continue;
      if (now - s.lastStrike < STRIKE_COOLDOWN_MS) continue;

      s.lastStrike = now;

      const velocity = Math.min(1, 0.28 + this.pointerSpeed * 1.5);
      const index = s.indexAtY(this.pointer.y);

      // Push the string the way the pointer was travelling.
      s.pluck(index, -side * 0.16 * velocity, 5);

      if (this.chime) {
        const pan = this.worldWidth ? (s.x / (this.worldWidth / 2)) * 0.7 : 0;
        this.chime.strike(s.freq, velocity, pan);
      }
    }
  }

  /** When left alone, a slow air current occasionally finds one string. */
  #breeze(now) {
    if (!this.chime || now - this.lastMoveAt < IDLE_BEFORE_BREEZE_MS) return;
    if (Math.random() > 0.004) return;

    const s = this.strings[Math.floor(Math.random() * this.strings.length)];
    if (now - s.lastStrike < 1200) return;

    s.lastStrike = now;
    s.pluck(Math.floor(NODES * (0.35 + Math.random() * 0.3)), 0.045, 6);
    const pan = this.worldWidth ? (s.x / (this.worldWidth / 2)) * 0.7 : 0;
    this.chime.strike(s.freq, 0.16, pan);
  }

  tick() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);

    const now = performance.now();
    const elapsed = (now - this.startedAt) / 1000;

    this.#breeze(now);

    for (let i = 0; i < this.strings.length; i++) {
      const s = this.strings[i];
      s.step();

      const positions = this.scratch;
      for (let n = 0; n < NODES; n++) {
        const t = n / (NODES - 1);
        positions[n * 3] = s.x + s.u[n];
        positions[n * 3 + 1] = STRING_TOP + t * (STRING_BOTTOM - STRING_TOP);
        positions[n * 3 + 2] = s.z;
      }
      this.lines[i].geometry.setPositions(positions);

      // A ringing string warms toward gold and thickens very slightly.
      const glow = Math.min(1, s.energy * 130);
      const mat = this.materials[i];
      mat.color.copy(REST_COLOR).lerp(RING_COLOR, glow);
      mat.opacity = 0.85 + glow * 0.15;
      mat.linewidth = (1.6 + (1 - s.slot) * 1.1) * (1 + glow * 0.35);
    }

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

    window.removeEventListener("resize", this.onResize);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);

    for (const line of this.lines) line.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.dust.geometry.dispose();
    this.dust.material.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
