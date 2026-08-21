import * as THREE from "three";
import { VibratingString } from "./string-sim.js";
import { buildGlyphAtlas } from "./glyph-atlas.js";
import roofUrl from "../assets/roof.webp";

const STRING_COUNT = 38;
const NODES = 28;

const WORLD_HEIGHT = 10;
const ROOF_ASPECT = 1400 / 732; // the trimmed artwork's true ratio

/** The text the curtain is woven from; it repeats across strands. */
const CURTAIN_TEXT = "THE STRINGS REMEMBER EVERY HAND THAT HAS PASSED THROUGH THEM ";

const REST_COLOR = new THREE.Color("#4a4235");
const RING_COLOR = new THREE.Color("#c8922f");

const STRIKE_COOLDOWN_MS = 70;
const IDLE_BEFORE_BREEZE_MS = 6500;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

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
    this.stringTop = 0;
    this.stringBottom = -4;
    this.glyphSize = 0.17;

    this.#buildStrings();
    this.#buildCurtain();
    this.#buildRoof();
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
        x: 0, // real x comes from layout(), which depends on viewport width
        z: 0,
        top: 0,
        bottom: -4,
        nodes: NODES,
        speed: 0.3 + t * 0.1,
        damping: 0.9968 - t * 0.001,
        freq: freqs[i],
        freeEnd: true,
      });
      sim.slot = t;
      this.strings.push(sim);
    }
  }

  /**
   * One mesh for every letter in the curtain. Each glyph is a quad whose four
   * corners are rewritten each frame from its strand's shape, so the letters
   * ride the wave and tilt with the strand's local angle.
   */
  #buildCurtain() {
    const { canvas, index } = buildGlyphAtlas(CURTAIN_TEXT);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.atlasTexture = texture;

    // Spaces in the source text become gaps in the curtain rather than blank
    // quads, so nothing is drawn for them at all.
    const cells = [];
    for (let i = 0; i < STRING_COUNT; i++) {
      for (let n = 0; n < NODES; n++) {
        // Offset each strand so neighbours don't start on the same letter.
        const ch = CURTAIN_TEXT[(n + i * 7) % CURTAIN_TEXT.length];
        const uv = index.get(ch);
        if (uv) cells.push({ string: i, node: n, uv });
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
      indices[k] = v;         indices[k + 1] = v + 1; indices[k + 2] = v + 2;
      indices[k + 3] = v;     indices[k + 4] = v + 2; indices[k + 5] = v + 3;
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

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
    });

    this.curtain = new THREE.Mesh(geometry, material);
    this.curtain.frustumCulled = false;
    this.curtain.renderOrder = 2;
    this.scene.add(this.curtain);
  }

  #buildRoof() {
    const texture = new THREE.TextureLoader().load(roofUrl, () => {
      // The artwork decides nothing about layout, but a repaint once it lands
      // avoids a frame of missing roof.
      if (!this.disposed) this.onResize();
    });
    texture.colorSpace = THREE.SRGBColorSpace;

    this.roof = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false })
    );
    // Painted last so the strands appear to hang from behind the beam.
    this.roof.renderOrder = 5;
    this.scene.add(this.roof);
  }

  #buildDust() {
    const count = 200;
    const positions = new Float32Array(count * 3);
    this.dustSeeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 24;
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

    this.renderer.setSize(w, h);

    const aspect = w / h;
    this.worldWidth = WORLD_HEIGHT * aspect;

    this.camera.left = -this.worldWidth / 2;
    this.camera.right = this.worldWidth / 2;
    this.camera.top = WORLD_HEIGHT / 2;
    this.camera.bottom = -WORLD_HEIGHT / 2;
    this.camera.updateProjectionMatrix();

    // The roof is capped by height on wide screens and by width on narrow ones,
    // so the pavilion keeps its proportions instead of swallowing the viewport.
    const roofWidth = Math.min(this.worldWidth * 0.92, WORLD_HEIGHT * 0.5 * ROOF_ASPECT);
    const roofHeight = roofWidth / ROOF_ASPECT;
    const roofTop = WORLD_HEIGHT / 2 - 0.3;
    const roofBottom = roofTop - roofHeight;

    this.roof.scale.set(roofWidth, roofHeight, 1);
    this.roof.position.set(0, roofBottom + roofHeight / 2, 1);

    // Strands hang from the beam, inside the upturned eaves.
    const span = roofWidth * 0.76;
    // Start a little above the roof's lower edge so the tops are hidden behind it.
    this.stringTop = roofBottom + roofHeight * 0.13;
    this.stringBottom = -WORLD_HEIGHT / 2 + 0.85;

    // Letters must clear their neighbours both across the curtain and down each
    // strand, so the smaller of the two spacings sets the glyph size.
    const gap = span / (STRING_COUNT - 1);
    const rowGap = (this.stringTop - this.stringBottom) / (NODES - 1);
    this.glyphSize = Math.min(gap, rowGap) * 0.98;

    for (const s of this.strings) {
      s.x = -span / 2 + s.slot * span;
      s.top = this.stringTop;
      s.bottom = this.stringBottom;
      // Strands may lean past their neighbours a little — that overlap is what
      // a real curtain does — but not so far that the text becomes unreadable.
      s.maxAmplitude = gap * 1.2;
    }

    this.pushRadius = gap * 5;
  }

  onPointerMove(e) {
    const rect = this.container.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

    const x = (ndcX * this.worldWidth) / 2;
    const y = (ndcY * WORLD_HEIGHT) / 2;

    if (!this.pointerActive) {
      // Seed both points on entry, so we don't read a bogus crossing of every
      // strand between wherever the pointer left and where it came back.
      this.prevPointer.set(x, y);
      this.pointerActive = true;
    } else {
      this.prevPointer.copy(this.pointer);
    }

    this.pointer.set(x, y);
    this.pointerSpeed = this.pointer.distanceTo(this.prevPointer);
    this.lastMoveAt = performance.now();

    this.#swayNearby();
    this.#detectCrossings();
  }

  onPointerLeave() {
    this.pointerActive = false;
    this.pointerSpeed = 0;
  }

  /**
   * Strands near the pointer are pushed aside without being struck — the bow
   * wave you get moving a hand through a hanging curtain. Scaled by pointer
   * speed so resting the cursor mid-curtain doesn't pump energy in forever.
   */
  #swayNearby() {
    const drive = Math.min(0.09, this.pointerSpeed * 0.5);
    if (drive <= 0.0002) return;

    for (const s of this.strings) {
      const index = s.indexAtY(this.pointer.y);
      if (index < 0) continue;

      const dx = this.pointer.x - (s.x + s.u[index]);
      const dist = Math.abs(dx);
      if (dist > this.pushRadius) continue;

      const falloff = smoothstep(this.pushRadius, 0, dist);
      const dir = dx >= 0 ? -1 : 1; // pushed away from the pointer
      s.pluck(index, dir * drive * falloff, 6);
    }
  }

  /**
   * A strand is struck when the pointer changes which side of it it is on
   * between two frames. Comparing sides rather than distance means a fast flick
   * still rings every strand it passed through, instead of skipping the ones
   * that fell between two pointer samples.
   */
  #detectCrossings() {
    if (!this.pointerActive) return;
    const now = performance.now();

    for (const s of this.strings) {
      const disp = s.displacementAtY(this.pointer.y);
      if (disp === null) continue;

      const surfaceX = s.x + disp;
      // Deliberately a two-state side with no zero: Math.sign() reports 0 for a
      // pointer sitting exactly on a strand, and skipping that sample plus the
      // next would swallow the crossing entirely.
      const side = this.pointer.x - surfaceX >= 0 ? 1 : -1;
      const prevSide = this.prevPointer.x - surfaceX >= 0 ? 1 : -1;

      if (side === prevSide) continue;
      if (now - s.lastStrike < STRIKE_COOLDOWN_MS) continue;

      s.lastStrike = now;

      const velocity = Math.min(1, 0.28 + this.pointerSpeed * 1.5);
      const index = s.indexAtY(this.pointer.y);
      s.pluck(index, -side * 0.16 * velocity, 5);

      if (this.chime) {
        const pan = this.worldWidth ? (s.x / (this.worldWidth / 2)) * 0.7 : 0;
        this.chime.strike(s.freq, velocity, pan);
      }
    }
  }

  #breeze(now) {
    if (!this.chime || now - this.lastMoveAt < IDLE_BEFORE_BREEZE_MS) return;
    if (Math.random() > 0.004) return;

    const s = this.strings[Math.floor(Math.random() * this.strings.length)];
    if (now - s.lastStrike < 1200) return;

    s.lastStrike = now;
    s.pluck(Math.floor(NODES * (0.35 + Math.random() * 0.3)), 0.05, 7);
    const pan = this.worldWidth ? (s.x / (this.worldWidth / 2)) * 0.7 : 0;
    this.chime.strike(s.freq, 0.16, pan);
  }

  /** Rewrite every glyph quad from the current shape of its strand. */
  #updateCurtain() {
    const pos = this.posAttr.array;
    const col = this.colAttr.array;
    const half = this.glyphSize / 2;
    const span = this.stringTop - this.stringBottom;
    const tint = new THREE.Color();

    // Per-strand values are constant across its glyphs, so compute them once.
    const glow = this.strings.map((s) => Math.min(1, s.energy * 150));

    for (let q = 0; q < this.cells.length; q++) {
      const cell = this.cells[q];
      const s = this.strings[cell.string];
      const n = cell.node;

      const t = n / (NODES - 1);
      const cx = s.x + s.u[n];
      const cy = this.stringTop - t * span;

      // Tilt each letter to the strand's local direction, so the text bends
      // with the wave instead of sliding along a rigid column.
      const a = n === 0 ? 0 : n - 1;
      const b = n === NODES - 1 ? n : n + 1;
      const dx = s.u[b] - s.u[a];
      const dy = -((b - a) / (NODES - 1)) * span;
      const angle = Math.atan2(dy, dx) + Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const hx = half * cos;
      const hy = half * sin;
      const vx = -half * sin;
      const vy = half * cos;

      const o = q * 12;
      pos[o]      = cx - hx - vx; pos[o + 1]  = cy - hy - vy; pos[o + 2]  = 0;
      pos[o + 3]  = cx + hx - vx; pos[o + 4]  = cy + hy - vy; pos[o + 5]  = 0;
      pos[o + 6]  = cx + hx + vx; pos[o + 7]  = cy + hy + vy; pos[o + 8]  = 0;
      pos[o + 9]  = cx - hx + vx; pos[o + 10] = cy - hy + vy; pos[o + 11] = 0;

      tint.copy(REST_COLOR).lerp(RING_COLOR, glow[cell.string]);
      const c = q * 12;
      for (let v = 0; v < 4; v++) {
        col[c + v * 3] = tint.r;
        col[c + v * 3 + 1] = tint.g;
        col[c + v * 3 + 2] = tint.b;
      }
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  tick() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);

    const now = performance.now();
    const elapsed = (now - this.startedAt) / 1000;

    this.#breeze(now);
    for (const s of this.strings) s.step();
    this.#updateCurtain();

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

    this.curtain.geometry.dispose();
    this.curtain.material.dispose();
    this.atlasTexture.dispose();

    this.roof.geometry.dispose();
    this.roof.material.map?.dispose();
    this.roof.material.dispose();

    this.dust.geometry.dispose();
    this.dust.material.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
