import * as THREE from "three";

/**
 * Spray drifting up from the foot of the painted waterfalls.
 *
 * Puffs are quads rather than GL points: `gl_PointSize` is capped by the driver,
 * and a puff wide enough to read as spray on a high-DPI screen can exceed that
 * cap and be silently clamped to a smaller square.
 *
 * Additive blending is the obvious choice for mist and is wrong here. The canvas
 * is transparent and the painting is a CSS background *behind* it, so there is
 * nothing in the framebuffer to add to: puffs accumulate dark colour against
 * black with partial alpha, and composite over the page as grey stains. They are
 * therefore drawn with ordinary alpha blending — translucent white laid over the
 * painting, which is what mist looks like anyway.
 *
 * That needs a per-puff opacity, and a `MeshBasicMaterial` cannot give one:
 * vertex colours drive RGB only, so fading a puff by darkening its colour turns
 * it grey rather than transparent. Hence the small shader below, whose only job
 * is to carry an alpha attribute through to the fragment.
 */
const TAU = Math.PI * 2;

/** A soft round blob, alpha falling away from the centre. */
function buildPuffTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // A long, gentle falloff. Anything steeper and each puff reads as a distinct
  // blob instead of dissolving into its neighbours.
  g.addColorStop(0.0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.25, "rgba(255,255,255,0.52)");
  g.addColorStop(0.55, "rgba(255,255,255,0.20)");
  g.addColorStop(0.8, "rgba(255,255,255,0.05)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

export class Mist {
  /** @param {number} perSource puffs allotted to each waterfall */
  constructor(perSource = 90) {
    this.perSource = perSource;
    this.sources = [];
    this.count = 0;

    this.texture = new THREE.CanvasTexture(buildPuffTexture());
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.texture },
        uColor: { value: new THREE.Color(0xfffdf7) },
      },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        varying vec2 vUv;
        void main() {
          vAlpha = aAlpha;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        varying vec2 vUv;
        void main() {
          float a = texture2D(uMap, vUv).a * vAlpha;
          if (a <= 0.002) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // above the backdrop, behind the curtain
    this.mesh.visible = false;
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

    for (let i = 0; i < count; i++) {
      // Stagger the initial ages so the plumes are already running at first
      // frame instead of every puff being born together in one visible pulse.
      this.#respawn(i, Math.random());
    }
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

    const positions = new Float32Array(count * 4 * 3);
    const uvs = new Float32Array(count * 4 * 2);
    const alphas = new Float32Array(count * 4);
    const index = new Uint32Array(count * 6);

    for (let q = 0; q < count; q++) {
      const o = q * 8;
      uvs[o] = 0; uvs[o + 1] = 0;
      uvs[o + 2] = 1; uvs[o + 3] = 0;
      uvs[o + 4] = 1; uvs[o + 5] = 1;
      uvs[o + 6] = 0; uvs[o + 7] = 1;

      const v = q * 4;
      const k = q * 6;
      index[k] = v; index[k + 1] = v + 1; index[k + 2] = v + 2;
      index[k + 3] = v; index[k + 4] = v + 2; index[k + 5] = v + 3;
    }

    this.posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);

    const geo = this.mesh.geometry;
    geo.dispose();
    const fresh = new THREE.BufferGeometry();
    fresh.setAttribute("position", this.posAttr);
    fresh.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    fresh.setAttribute("aAlpha", this.alphaAttr);
    fresh.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry = fresh;
    this.mesh.visible = true;
  }

  #respawn(i, startAge = 0) {
    const s = this.sources[Math.floor(i / this.perSource)];
    this.src[i] = Math.floor(i / this.perSource);

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

    const pos = this.posAttr.array;
    const alphas = this.alphaAttr.array;

    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) this.#respawn(i);

      const t = this.age[i] / this.life[i];

      // Rising spray slows as it loses momentum and wanders sideways.
      this.py[i] += this.vy[i] * (1 - t * 0.65) * dt;
      this.px[i] += (this.vx[i] + Math.sin(elapsed * 0.5 + this.seed[i]) * 0.12) * dt;

      // Fade in briskly, linger, then thin out — no puff should pop in or out.
      const fadeIn = Math.min(1, t / 0.18);
      const fadeOut = 1 - Math.max(0, (t - 0.45) / 0.55);
      const alpha = fadeIn * fadeOut * fadeOut * this.gain[i];

      // Spray expands as it disperses, but modestly — a puff that doubles in
      // size reads as one growing blob rather than as dispersing vapour.
      const half = (this.size[i] * (0.6 + t * 0.55)) / 2;

      const x = this.px[i];
      const y = this.py[i];
      const o = i * 12;
      pos[o] = x - half;     pos[o + 1] = y - half;  pos[o + 2] = 0;
      pos[o + 3] = x + half; pos[o + 4] = y - half;  pos[o + 5] = 0;
      pos[o + 6] = x + half; pos[o + 7] = y + half;  pos[o + 8] = 0;
      pos[o + 9] = x - half; pos[o + 10] = y + half; pos[o + 11] = 0;

      const a = i * 4;
      alphas[a] = alphas[a + 1] = alphas[a + 2] = alphas[a + 3] = alpha;
    }

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
