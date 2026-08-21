/**
 * Packs every distinct character into one canvas texture, so the whole curtain
 * of letters draws in a single draw call instead of one per glyph.
 *
 * Glyphs are painted white on transparent; the mesh tints them per-vertex, which
 * is what lets a ringing strand warm toward gold without needing its own
 * material.
 */
export function buildGlyphAtlas(text, cell = 72) {
  const glyphs = [...new Set(text)].filter((c) => c.trim().length > 0);

  const cols = Math.ceil(Math.sqrt(glyphs.length));
  const rows = Math.ceil(glyphs.length / cols);

  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;

  const ctx = canvas.getContext("2d");
  ctx.font = `700 ${Math.floor(cell * 0.66)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";

  const index = new Map();

  glyphs.forEach((ch, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.fillText(ch, col * cell + cell / 2, row * cell + cell / 2);

    // Canvas textures are uploaded flipped, so row 0 lives at the top of UV space.
    index.set(ch, {
      u0: col / cols,
      v0: 1 - (row + 1) / rows,
      du: 1 / cols,
      dv: 1 / rows,
    });
  });

  return { canvas, index };
}
