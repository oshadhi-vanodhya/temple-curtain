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

**`src/lib/string-sim.js` — the strands.**
Each string solves the 1D wave equation along its length rather than simulating
free 2D particles:

```
u[i]″ = c² · (u[i-1] − 2u[i] + u[i+1])
```

Every node stores only its lateral displacement. This is far more stable than
free verlet particles and physically truer — waves actually travel to the pinned
ends, reflect, and interfere on the way back, which is what makes the motion read
as a *string* rather than a wobbling rope. `c` is held below 1 to satisfy the
Courant stability condition.

Each strand is pinned at the roof beam but **free at the bottom**, which is what
a hanging curtain does. A free end needs a Neumann boundary — the last node copies
its neighbour rather than being held at zero — and without it the sway dies
completely, because a string clamped at both ends is a harp string, not a curtain.

The strands are also damped like **cloth rather than wire**. With light damping
each one rang on at its own natural frequency, so moments after a gust they had
drifted out of phase and the curtain churned, with neighbours leaning opposite
ways. Heavy damping and a near-uniform wave speed keep the whole curtain
answering a gust as one sheet and settling together.

Displacement is capped relative to the spacing between neighbours, so no amount of
frantic input turns the text into an unreadable pile. A strand already under
tension resists further displacement, so repeated strikes ring it brighter instead
of pushing it ever wider.

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

Two different pointer responses, deliberately kept separate:

- **Near** the curtain, the pointer acts as a **gust of wind**. Every strand
  leans the *same* way at any instant — only the amount differs. Strands nearest
  where the gust lands lean furthest and the rest trail off with distance, down
  to a floor so that even the far edge stirs a little. Direction comes from the
  pointer's horizontal travel, so dragging left blows the curtain left. The gust
  outlives the movement that made it and dies over about a second, which lets the
  curtain swing back and settle on its own instead of snapping straight the
  moment the pointer stops. No sound.

  Gust strength runs through a **compressive curve** rather than scaling linearly
  with pointer speed. Linearly, a gentle drift was nearly inert while fast moves
  already clamped at full strength, and raising the gain alone would only have
  widened that gap — it cannot lift the quiet end without pushing the loud end
  further into the clamp. An exponent below 1 lifts the quiet end and leaves the
  loud end where it is:

  | pointer speed | hem leans |
  |---|---|
  | very slow drift | 19 px |
  | slow drift | 28 px |
  | brisk flick | 63 px |

  Note that the travel ceiling is both the clamp *and* the scale the wind leans
  against, so raising it buys no headroom — it simply widens every gust in
  proportion. It is set by how far the strongest gust should throw the hem.

  An earlier version pushed strands *away* from the pointer on both sides. That
  is what a solid object does, and it looked like a hole punched through the
  fabric rather than cloth moving. Wind has one direction; that single change is
  what makes it read as a curtain.

- **Across** a strand, it is struck and rings. A strand counts as struck when the
  pointer changes which *side* of it it is on between two frames — comparing
  sides rather than measuring distance means a fast flick still catches every
  strand it passed through, instead of skipping the ones that fell between two
  pointer samples.

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
