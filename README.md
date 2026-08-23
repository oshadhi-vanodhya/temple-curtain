# Temple — a curtain of letters

An interactive instrument in React and three.js. Thirty-eight strands of letters —
about forty letters each — hang from a temple roof like a beaded curtain, in a
still, creme-lit room. Move the pointer near them and they heave aside; move it
*through* them and each strand you cross rings with a struck-metal chime and
carries a visible wave down its length, the letters tilting as it passes.

The sound is generated at runtime — no audio files. The only binary assets are the
roof and the painted backdrop.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle into dist/
```

Sound sits behind a one-click gate on load. That is not decoration: browsers
start every `AudioContext` suspended and only a real user gesture may resume it.

## How it works

**`src/lib/cloth.js` — the cloth.**
A verlet cloth: a grid of particles held by distance constraints, pinned along
the top row, falling under gravity.

This replaced an earlier 1D model in which each strand stored only a lateral
displacement. That could ripple, but it could never behave as cloth — a strand
could not gather, fold, swing on its own hinge or hang under its own weight,
because there was no second dimension for it to do any of that in. Here every
particle moves freely in the plane and the sheet's shape is whatever the
constraints and gravity settle on.

Two families of constraint, and the difference between them is what makes it read
as a curtain rather than a net:

- **Vertical**, down each strand: barely allowed to stretch, free to compress.
  These carry the weight.
- **Horizontal**, between neighbouring strands: loose in both directions. They let
  strands drift apart and bunch together while still dragging on one another,
  which is what gives the sheet its cohesion.

Constraints are *slack*: they pull only when a link is shorter than its minimum or
longer than its maximum, and do nothing in between. A cloth of stiff exact-length
links behaves like a screen door. They are relaxed Gauss-Seidel style, five cheap
sweeps rather than one exact solve.

Two things worth knowing about the numbers:

- Every vertical link ends up carrying the weight of all the cloth beneath it, so
  after five passes the sheet settles about **1.21x its cut length** — past what
  the 1.1 stretch limit implies, because a slack constraint sharing a pinned
  partner only closes half its error per pass. The sheet is therefore cut short by
  that same factor and arrives at the intended length once hung.
- The pointer's shove is expressed as a **multiple of gravity**, not as the
  reference's bare constant. That constant does not survive the change of scale —
  carried across faithfully it moved this sheet by a fifth of a pixel. A hanging
  cloth is taut under its own weight, so a shove must be large against gravity
  before it reads at all. Measured across a sweep, the response is linear: 20x
  moves the sheet 12px, 45x moves it 40px and leaves nothing crossed over, 65x
  reaches 77px but folds strands past one another and scrambles the text.

Pushed hard, the sheet gathers into real folds — and then recovers, because
gravity pulls every strand back under its own pin. A 239px deformation settles
back to 3px on its own.

The cloth can also be **taken hold of**: pointerdown pins the nearest particle to
the cursor so a fold can be dragged out of the curtain by hand, and releasing it
hands the particle back to gravity.

**`src/lib/chime.js` — the sound.**
A struck bowl is *inharmonic*: its partials are not integer multiples of the
fundamental, which is precisely why a bell reads as a bell and not an organ. Six
partials at bell-family ratios (1, 2.01, 2.76, 4.07, 5.43, 7.12), with the lower
ones ringing longest. The fundamental and second partial are each split into a
detuned pair that beat slowly against one another — that shimmer is what keeps a
struck bowl sounding alive rather than synthetic. A whisper of filtered noise at
onset supplies the strike transient.

Reverb is a `ConvolverNode` fed a procedurally generated impulse: decaying stereo
noise plus a few sparse early reflections, so it reads as a stone hall instead of
flat noise.

The strands are tuned to a minor pentatonic from D4 (294 Hz) up to 3520 Hz. Any
two notes in that set are consonant, so dragging across the whole array at speed
still resolves as music rather than a pile-up. Gain tilts down toward the top of
the range, because our hearing peaks around 3–4 kHz and equal-amplitude sines get
harsh as they climb.

**The backdrop.**
The painting runs the full width of the viewport and is pinned to the bottom
edge. It is 4:3, so at full width it stands taller than the window and its sky is
cropped off the top — which is the intent: the mountains, blossoms and ruled
lower border sit along the bottom of the frame at full size.

Because nothing is letterboxed, the scene is composed against the viewport
itself; only the curtain's lower margin answers to the painting, stopping just
above the ruled border. Layout is driven by a `ResizeObserver` plus a per-frame
box check rather than the window `resize` event — that event was observed not to
reach the handler after a viewport change, leaving the world scale stale and the
scene visibly mis-sized.

**`src/lib/glyph-atlas.js` + `src/lib/scene.js` — the curtain.**
Every distinct character is packed into a single canvas atlas, so the whole
curtain draws in **one draw call** rather than one per letter. Each glyph is a
quad whose four corners are rewritten every frame from its strand's current
shape, and each letter is rotated to the strand's *local* angle — so the text
bends with the wave instead of sliding along a rigid column. Glyphs are painted
white and tinted per-vertex, which is how a ringing strand warms toward gold
without needing its own material. Spaces become real gaps: no quad is emitted
for them at all.

The text reads *down* each strand rather than across the rows, with neighbouring
strands offset from one another — indexing it the other way makes the curtain
read as a paragraph instead of as hanging threads.

Two pointer responses:

- **Moving near** the cloth shoves particles radially away, falling off with
  squared distance. There is no separate notion of wind any more — the cloth's own
  structure carries the motion. Shoving a handful of particles aside drags their
  neighbours along through the horizontal links, so the disturbance spreads across
  the sheet and down each strand by itself.
- **Crossing** a strand rings it. A strand counts as struck when the pointer
  changes which *side* of it it is on between two frames; comparing sides rather
  than distance means a fast flick still catches every strand it passed through.
  With the cloth free to move in two dimensions a strand is no longer a straight
  column, so the comparison is made against whichever of its particles is
  currently level with the pointer.

The roof is drawn last with `depthTest` off, so the strands appear to hang from
behind the beam. Its size is capped by height on wide screens and by width on
narrow ones, so the pavilion keeps its proportions instead of swallowing the
viewport.

The roof's height and the curtain's drop share one fixed vertical budget, and the
roof artwork's aspect is fixed — so every bit of extra drop for the strands comes
out of the roof. The split is set where the curtain reads as taller than it is
wide without the pavilion shrinking to a trinket.

Left alone for a while, a slow air current occasionally finds one strand.

## Notes

- Pointer events throughout, so it works with touch and pen as well as a mouse.
- Voices are capped at 56 and the ceiling is a safety valve, not a normal limit —
  one full sweep is 38 simultaneous voices and sweeps overlap.
- `prefers-reduced-motion` is honoured for the UI animation.
