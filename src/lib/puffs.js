import * as THREE from "three";

/**
 * Shared machinery for soft translucent sprites — waterfall spray and drifting
 * cloud alike.
 *
 * Puffs are quads rather than GL points: `gl_PointSize` is capped by the driver,
 * and a puff wide enough to read at high DPI can exceed that cap and be silently
 * clamped to a smaller square.
 *
 * They use ordinary alpha blending, not additive. Additive is the obvious choice
 * for vapour and is wrong here: the canvas is transparent and the painting is a
 * CSS background *behind* it, so there is nothing in the framebuffer to add to —
 * puffs accumulate colour against black and composite over the page as grey
 * stains. Translucent white laid over the painting is what vapour looks like
 * anyway.
 *
 * Alpha varies per puff, which a `MeshBasicMaterial` cannot express: vertex
 * colours drive RGB only, so fading a puff by darkening it turns it grey rather
 * than transparent. Hence the small shader below, whose sole job is to carry an
 * alpha attribute through to the fragment.
 */

/** A soft round blob whose alpha falls away from the centre. */
export function buildPuffTexture(stops, size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, alpha] of stops) g.addColorStop(at, `rgba(255,255,255,${alpha})`);

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * A pool of soft quads. Owns the geometry, material and mesh; callers own the
 * motion and simply write each puff's rectangle and opacity every frame.
 */
export class PuffField {
  constructor({ stops, color, renderOrder = 1 }) {
    this.texture = new THREE.CanvasTexture(buildPuffTexture(stops));
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.texture },
        uColor: { value: new THREE.Color(color) },
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
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.count = 0;
  }

  /** Allocate for `count` puffs. A no-op if the pool is already that size. */
  resize(count) {
    if (count === this.count) return;
    this.count = count;

    const positions = new Float32Array(count * 4 * 3);
    const uvs = new Float32Array(count * 4 * 2);
    const alphas = new Float32Array(count * 4);
    const index = new Uint32Array(count * 6);

    for (let q = 0; q < count; q++) {
      const o = q * 8;
      uvs[o] = 0;     uvs[o + 1] = 0;
      uvs[o + 2] = 1; uvs[o + 3] = 0;
      uvs[o + 4] = 1; uvs[o + 5] = 1;
      uvs[o + 6] = 0; uvs[o + 7] = 1;

      const v = q * 4;
      const k = q * 6;
      index[k] = v;     index[k + 1] = v + 1; index[k + 2] = v + 2;
      index[k + 3] = v; index[k + 4] = v + 2; index[k + 5] = v + 3;
    }

    this.posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);

    this.mesh.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute("aAlpha", this.alphaAttr);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.mesh.geometry = geo;
    this.mesh.visible = true;
  }

  /** Place one puff. Half-extents are separate so a puff can be a flat wisp. */
  set(i, x, y, halfX, halfY, alpha) {
    const p = this.posAttr.array;
    const o = i * 12;
    p[o] = x - halfX;     p[o + 1] = y - halfY;  p[o + 2] = 0;
    p[o + 3] = x + halfX; p[o + 4] = y - halfY;  p[o + 5] = 0;
    p[o + 6] = x + halfX; p[o + 7] = y + halfY;  p[o + 8] = 0;
    p[o + 9] = x - halfX; p[o + 10] = y + halfY; p[o + 11] = 0;

    const a = this.alphaAttr.array;
    const k = i * 4;
    a[k] = a[k + 1] = a[k + 2] = a[k + 3] = alpha;
  }

  flush() {
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
