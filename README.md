# Temple — a curtain of letters

An interactive instrument in React and three.js. Thirty-eight strands of letters —
about forty letters each — hang in the opening of a painted temple gateway like a
beaded curtain. Move the pointer near them and they heave aside; move it
*through* them and each strand you cross rings with a struck-metal chime and
carries a visible wave down its length, the letters tilting as it passes.

The sound is generated at runtime — no audio files. The only binary asset is the
painted backdrop.

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

**`src/lib/water.js` — the waterfall.**
A faint, continuous wash under everything, synthesised like the chime but by the
opposite method. Falling water has no pitch — it is broadband noise shaped by the
size of the drops and the space around them — so where the chime is built from
partials, this starts as noise and is carved into three bands: a low body where
water meets the pool, a mid rush for the bulk of the fall, and a high sparkle for
the spray.

Pink noise rather than white: white puts equal energy in every hertz, which reads
as a bright electronic hiss, while pink falls away with frequency the way natural
broadband sound does. Measured off the bus, the bands run -73, -81, -90 and -99 dB
from low to high — a steady roll-off, no tonal peak.

What stops it being a hiss is that nothing holds still. Slow oscillators at
deliberately unrelated rates drift the filter frequencies and band levels against
one another; measured over twelve seconds the mid band swells and recedes by
11 dB and the high band by 6 dB, independently. The noise buffer's tail is
cross-faded into its head as well, since a looping noise buffer otherwise ticks
once per cycle, and that tick is the one cue that gives a loop away.

The water is heard from inside the temple, not from the foot of the fall, and it
is deliberately dark almost to the point of being felt rather than heard.

Broadband noise above roughly a kilohertz is what the ear reads as hiss, and hiss
is the opposite of calming however quiet it is. So the body and rush bands pass
through a pair of cascaded low-passes — two shallow ones rather than one steep
filter, since a resonant filter would ring on the noise and sing. Measured against
an earlier, noisier version, that puts the 1-4 kHz band **20 dB down** while
costing the low body only 3 dB.

The spray band deliberately *bypasses* that veil. Routed through it, the
low-passes erase it completely and the bed becomes a dull hum with no sense of air
at all; kept separate and very quiet, it reads as the faint sheen above water
without bringing the hiss back. It is also set in a short, dark stone room of its
own, quite unlike the chime's hall, with most of the bed arriving as reflected
rather than direct sound.

Over that bed fall occasional drops into standing water. A drip is not a click: it
is the resonance of the bubble the drop leaves behind, which shrinks as it
collapses, so the pitch *rises* over the few tens of milliseconds it sounds.
Sweeping it upward is what separates a drip from a tap. They arrive at irregular
intervals — an even cadence reads as a metronome, not a leak — and go mostly to
the room, so each one answers from the stonework. Measured, they peak about 6.6 dB
above the bed.

It sits about 20 dB below a chime strike, and is panned left to the painted fall.
It runs on a dry bus that shares the tone shaping and limiter with the chime but
skips the reverb send — putting broadband noise through a hall impulse only smears
it.

**`src/lib/chime.js` — the sound.**
Modelled on the **bianzhong** (编钟), the bronze chime-bells of ancient China,
rather than on a Western bell or a Himalayan bowl. Fully synthesised — no samples.

The defining feature is the almond-shaped cross-section. Unlike a round bell it
sounds *two* pitches — the **sui**, struck at the centre, and the **gu**, struck
at the side, about a minor third apart — and a single strike excites both. That
interval inside one note is the signature; a round bell cannot produce it.
Measured off the output bus, a strike at 294 Hz shows peaks at **293 Hz and
351.6 Hz — a ratio of 1.197**, with the gu only 3.5 dB below the sui.

The same lens shape damps the fundamental fast, so a bianzhong has none of the
long cathedral hum of a Western bell: it speaks and stops. Measured, the strike
falls 40 dB in **1.0 s** and is silent by 1.5 s. The room is short and dry to
match — a long tail would drown bells this brief.

Strands are tuned to the Chinese five-tone scale, **gong shang jue zhi yu**,
which is what a bianzhong set is actually tuned to.

That scale is folded into a fixed span of three octaves rather than climbing one
strand at a time. A pentatonic rises an octave every five strands, so across
thirty-eight of them it reached nearly eight octaves: the upper strands ran to
**47 kHz** — inaudible, and past the Nyquist limit, where they aliased back down
as spurious tones. Bounding the span keeps the rise monotonic across the curtain,
lets neighbours share a note as a real chime set does, and keeps every strand
audible: 294 Hz to 1976 Hz, highest partial 12 kHz.

**The backdrop, and where the curtain hangs.**
The painting is covered and centred. It is near-widescreen already, so `cover`
costs almost nothing on a typical window while guaranteeing the gateway is never
letterboxed.

The artwork supplies its own pavilion, so there is no roof plane in the scene any
more — one would simply be a second roof stacked on the painted one. Instead the
curtain is hung in the painted gate's *opening*, and it fills that opening
completely. Every bound was measured off the image rather than eyeballed:

| | fraction of artwork |
|---|---|
| underside of the beam | 0.437 |
| foot of the pillar bases | 0.923 |
| inner faces of the pillar shafts | 0.384 / 0.621 |

The beam edge was found by luminance rather than by eye: across the middle of the
arch it jumps from 132 to 224 in a single row.

The soffit above the opening is **not a straight line** — the bracket work hangs
to 0.4876 near the pillars but only 0.4357 at the centre. A curtain with a flat
top therefore crosses the carving at both ends, which is what the outermost
strands were doing. That profile is sampled across the opening and used twice:
letters whose *top edge* rises above their own strand's soffit are dropped from
the draw (testing the centre instead still lets half a letter cross), and the
screen behind them is a shaped strip rather than a rectangle, so its upper edge
follows the timber. The pillars' gold dragon inlay
breaks each shaft into fragments, so their inner faces came from a smoothed
red-density profile rather than a solid-colour run.

The top bound matters particularly: nothing occludes the cloth, so a strand hung
above 0.437 would draw *on top of* the painted beam rather than emerging from
beneath it.

These fractions are converted into world space using the same `cover` fit the CSS
applies, so the curtain stays pinned inside the gateway at any viewport rather
than drifting off it when the window changes shape.

**`src/lib/puffs.js`, `mist.js`, `clouds.js` — vapour.**
Two effects share one implementation: spray rising from the painted waterfalls,
and cloud drifting across the sky. `puffs.js` owns the technique; the other two
own only the motion.
Soft plumes drift up from the foot of each painted fall, which are located by
their artwork fractions the same way the gateway is, so they stay on the water at
any viewport.

Puffs are quads rather than GL points: `gl_PointSize` is capped by the driver, and
a puff wide enough to read as spray on a high-DPI screen can exceed that cap and
be silently clamped to a smaller square.

Additive blending is the obvious choice for mist and is wrong here. The canvas is
transparent and the painting is a CSS background *behind* it, so there is nothing
in the framebuffer to add to — puffs accumulate colour against black and composite
over the page as **grey stains**, which is exactly what the first attempt looked
like. They are drawn with ordinary alpha blending instead: translucent white laid
over the painting, which is what mist looks like anyway.

That needs a per-puff opacity, and `MeshBasicMaterial` cannot give one — vertex
colours drive RGB only, so fading a puff by darkening it turns it grey rather than
transparent. Hence a small shader whose only job is to carry an alpha attribute
through to the fragment.

Overlapping alpha compounds as `1 - (1 - a)^n`, so a tight cluster of strong puffs
goes almost opaque and reads as a hard white spot rather than as vapour. Spray is
therefore spread wide and kept faint, and gets its density from overlap rather
than from any single puff.

**Cloud** wisps are far wider than they are tall and cross the sky at a crawl,
wrapping when they leave the frame.

Wisp size, count and opacity are set against a pixel readback of the canvas
overlay rather than judged by eye, because judging vapour by eye is what went
wrong repeatedly. How much is needed depends entirely on what is behind it: on an
earlier pale-cream backdrop white vapour was nearly invisible and had to be driven
hard, while against a saturated blue sky the same white reads at a fraction of the
strength.

The current settings average about a third of the sky meaningfully veiled with
peaks near 0.8 alpha — enough to read as weather without hiding the painting. The
ceiling is close by: at 0.18 panel-widths per wisp one side measures ~90% covered,
and at 0.22 it whites out entirely.

Cloud drifts more slowly than the spray rises. Cloud that visibly travels reads as
weather; cloud that barely moves reads as atmosphere.

There are **two bands**, not one: thin drifting cloud in the sky, and a broader,
flatter, nearly still layer of fog lying in the hills below it. They are kept
separate because they want different settings — driving a single band hard enough
to fill the mountains whites out the sky long before it reaches them. Both share
the gateway mask, since the pavilion spans that column of the image at every
height, and both are verified to leave the opening completely clear. The one thing they must not do is
pass over the painted pavilion: the backdrop is a CSS background *behind* the
canvas, so anything drawn here sits on top of the gateway's roof, and a wisp
crossing it would read as fog inside the building rather than behind it. The
roof's dense red was measured at x 0.306–0.694, and each wisp is faded to nothing
across a slightly wider span, so cloud dissolves before reaching it and reappears
on the far side.

**Legibility.**
Three things carry the text against a bright, busy painting:

- The ink is near-black rather than the soft brown it began as.
- The grid is coarser — 31 strands of 30 letters rather than 38 of 42. Glyph size
  follows the across-curtain spacing, so the only way to grow the letters is to
  divide the same opening into fewer strands. Rows had to open up with them:
  grown without that, a glyph's inked height exactly equalled the row pitch and
  the text stacked into a solid block.
- A translucent screen fills the gateway behind the letters. It ends exactly on
  the pillars and the beam, so it reads as paper hung in the gate rather than a
  panel floating over the painting, and it is sheer enough that the river and
  mountains still show through.

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
