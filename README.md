# Temple — nineteen strings

An interactive instrument in React and three.js. Nineteen taut strings hang in a
still, creme-lit room. Move the pointer across them and each one you cross rings
with a struck-metal chime and carries a visible wave up and down its length.

Everything is generated at runtime — no audio files, no textures, no network
requests beyond the webfont.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle into dist/
```

Sound sits behind a one-click gate on load. That is not decoration: browsers
start every `AudioContext` suspended and only a real user gesture may resume it.

## How it works

**`src/lib/string-sim.js` — the strings.**
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

Displacement is capped at 36% of the spacing between neighbours, so no amount of
frantic input can make two strings visually cross. A string already under tension
resists further displacement, so repeated strikes ring it brighter instead of
pushing it ever wider.

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

The strings are tuned to a minor pentatonic from D4 (294 Hz) up to 3520 Hz. Any
two notes in that set are consonant, so dragging across the whole array at speed
still resolves as music rather than a pile-up. Gain tilts down toward the top of
the range, because our hearing peaks around 3–4 kHz and equal-amplitude sines get
harsh as they climb.

**`src/lib/scene.js` — the scene.**
An orthographic three.js camera with `Line2` for real line width (plain GL lines
are locked to 1px on most platforms). A string is struck when the pointer changes
which *side* of it it is on between two frames — comparing sides rather than
measuring distance means a fast flick still registers every string it passed
through, instead of skipping the ones that fell between two pointer samples.

Left alone for a while, a slow air current occasionally finds one string.

## Notes

- Pointer events throughout, so it works with touch and pen as well as a mouse.
- Voices are capped at 40 and the ceiling is a safety valve, not a normal limit —
  one full sweep is 19 simultaneous voices and sweeps overlap.
- `prefers-reduced-motion` is honoured for the UI animation.
