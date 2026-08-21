# Temple — a curtain of letters

An interactive instrument in React and three.js. Thirty-eight strands of letters —
about forty letters each — hang from a temple roof like a beaded curtain, in a
still, creme-lit room. Move the pointer near them and they heave aside; move it
*through* them and each strand you cross rings with a struck-metal chime and
carries a visible wave down its length, the letters tilting as it passes.

The sound is generated at runtime — no audio files. The only binary asset is the
roof.

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

- **Near** a strand, it is shoved away — the curtain parts around the pointer as
  though something solid were pushing through it, and closes again once it
  leaves. This is a standing field evaluated every frame, *not* driven by pointer
  speed: an earlier version scaled the push by how fast the cursor moved, which
  meant a slow approach did nothing at all and you had to swipe to get a
  reaction. Each node eases toward a target shaped by how near the pointer is,
  rather than being shoved until it hits its travel ceiling — accumulating a flat
  shove makes every strand within reach saturate at the same offset and the
  curtain opens as a flat-sided hole. Push direction comes from each strand's
  *rest* position, so a strand always retreats to its own side instead of being
  caught in a tug of war as the pointer crosses it. The nearest strand flies
  about 28 px, one three along about 12 px, and the corridor opens roughly five
  strand widths. No sound.
- A faster flick adds a speed-driven sway on top: a broad whole-strand push
  weighted toward the free bottom end, since a hanging thing swings along its
  length rather than denting in one spot.
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

Because strands flee an approaching pointer, drifting in slowly parts the curtain
in silence while a quick sweep still catches and rings every strand it passes —
the strands cannot get out of the way in time. That falls out of the two
behaviours rather than being special-cased.

Left alone for a while, a slow air current occasionally finds one strand.

## Notes

- Pointer events throughout, so it works with touch and pen as well as a mouse.
- Voices are capped at 56 and the ceiling is a safety valve, not a normal limit —
  one full sweep is 38 simultaneous voices and sweeps overlap.
- `prefers-reduced-motion` is honoured for the UI animation.
