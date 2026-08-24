/**
 * Procedural temple-chime synthesis.
 *
 * Everything here is generated at runtime with the Web Audio API — no samples,
 * no network requests. A struck metal bowl/tingsha is inharmonic: its partials
 * are not integer multiples of the fundamental, which is exactly why a bell
 * reads as "bell" and not as "organ". The ratios below are the classic
 * bell-family spread, with the lower partials ringing longest.
 */

/**
 * Modelled on the bianzhong — the bronze chime-bells of ancient China — rather
 * than on a Western bell or a Himalayan bowl.
 *
 * The defining feature is the almond-shaped cross-section: unlike a round bell
 * it sounds *two* pitches, the sui (struck at the centre) and the gu (struck at
 * the side), about a minor third apart, and a single strike excites both. That
 * interval inside one note is the sound's signature — a round bell cannot make
 * it. The same lens shape damps the fundamental quickly, so a bianzhong has
 * none of the long cathedral hum of a Western bell; it speaks and stops.
 */
const MINOR_THIRD = Math.pow(2, 3 / 12); // 1.1892 — the sui/gu interval

const PARTIALS = [
  { ratio: 1.0, gain: 1.0, decay: 1.0, detune: 0.5 },            // sui
  { ratio: MINOR_THIRD, gain: 0.72, decay: 0.86, detune: -0.6 }, // gu
  { ratio: 2.0, gain: 0.34, decay: 0.5 },
  { ratio: 2 * MINOR_THIRD, gain: 0.26, decay: 0.42 },
  { ratio: 3.42, gain: 0.14, decay: 0.28 },
  { ratio: 4.63, gain: 0.08, decay: 0.2 },
  { ratio: 6.1, gain: 0.04, decay: 0.14 },
];

const MAX_VOICES = 56;

/** Decaying stereo noise — a convolution impulse that reads as a stone hall. */
function buildImpulse(ctx, seconds = 3.2, decay = 2.6) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);

  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
    // A couple of sparse early reflections stop it sounding like flat noise.
    for (const [ms, amp] of [[17, 0.5], [31, 0.36], [53, 0.24]]) {
      const idx = Math.floor((ms / 1000) * rate) + channel * 13;
      if (idx < length) data[idx] += amp * (Math.random() > 0.5 ? 1 : -1);
    }
  }
  return impulse;
}

export class ChimeEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.voices = 0;
  }

  /**
   * Must be called from inside a real user gesture — browsers start every
   * AudioContext suspended and only a trusted event can resume it.
   */
  async start() {
    if (this.ready) return true;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    // Master chain: everything lands here, gets tamed, then goes out.
    const master = ctx.createGain();
    master.gain.value = 0.9;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    // Takes the glassy edge off the top partials.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 9000;
    tone.Q.value = 0.4;

    const reverb = ctx.createConvolver();
    reverb.buffer = buildImpulse(ctx, 2.0, 3.0);
    const wet = ctx.createGain();
    wet.gain.value = 0.26;

    master.connect(tone);
    tone.connect(limiter);

    // A dry path for continuous ambience. It shares the tone shaping and the
    // limiter so the whole mix stays controlled, but skips the reverb send —
    // running broadband noise through a hall impulse only smears it.
    this.ambientBus = ctx.createGain();
    this.ambientBus.connect(tone);
    limiter.connect(ctx.destination);

    master.connect(reverb);
    reverb.connect(wet);
    wet.connect(limiter);

    this.master = master;

    await ctx.resume();

    if (ctx.state !== "running") {
      // Hand the context back rather than leaving it suspended and orphaned.
      // Browsers cap how many an page may hold at once, so a few refused
      // starts would otherwise use up the budget and make later, legitimate
      // attempts throw instead of simply returning false.
      await ctx.close();
      this.ctx = null;
      this.master = null;
      this.ambientBus = null;
      return false;
    }

    this.ready = true;
    return true;
  }

  /**
   * Strike one string.
   * @param {number} freq     fundamental in Hz
   * @param {number} velocity 0..1, how hard the pointer crossed it
   * @param {number} pan      -1..1, follows the string's screen position
   */
  strike(freq, velocity = 0.6, pan = 0) {
    if (!this.ready || this.voices >= MAX_VOICES) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const v = Math.min(1, Math.max(0.05, velocity));

    // Higher strings ring a little shorter, as thinner metal does.
    const base = 1.9 * (1 - Math.min(0.45, (freq - 290) / 3200));

    // Equal-amplitude sines get harsher as they climb, because our hearing
    // peaks around 3-4 kHz. Tilting the top of the range down keeps the
    // highest strings sweet instead of piercing.
    const tilt = 1 - Math.min(0.42, Math.max(0, (freq - 700) / 5200));

    const voice = ctx.createGain();
    voice.gain.value = 0.115 * v * tilt;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));

    voice.connect(panner);
    panner.connect(this.master);

    let longest = 0;

    for (const p of PARTIALS) {
      const dur = base * p.decay;
      longest = Math.max(longest, dur);

      // Detuned pairs beat slowly against each other — that slow shimmer is
      // what makes a struck bowl sound alive rather than synthetic.
      const voices = p.detune ? [p.detune, -p.detune] : [0];

      for (const cents of voices) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        // Struck metal starts fractionally sharp and settles — a small glide,
        // but its absence is what makes a synthetic bell sound switched-on
        // rather than hit.
        const f = freq * p.ratio;
        osc.frequency.setValueAtTime(f * 1.006, now);
        osc.frequency.exponentialRampToValueAtTime(f, now + 0.07);
        osc.detune.value = cents;

        const g = ctx.createGain();
        const peak = (p.gain / voices.length) * (0.7 + 0.3 * v);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(peak, now + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(g);
        g.connect(voice);
        osc.start(now);
        osc.stop(now + dur + 0.05);
      }
    }

    // The strike transient: a whisper of filtered noise at the moment of contact.
    const noiseLen = Math.floor(ctx.sampleRate * 0.035);
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLen, 3);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = Math.min(12000, freq * 7);
    bp.Q.value = 0.9;

    const ng = ctx.createGain();
    ng.gain.value = 0.16 * v;

    noise.connect(bp);
    bp.connect(ng);
    ng.connect(voice);
    noise.start(now);

    this.voices++;
    const release = () => {
      this.voices = Math.max(0, this.voices - 1);
      voice.disconnect();
      panner.disconnect();
    };
    // One timer for the whole voice, rather than one per oscillator.
    setTimeout(release, (longest + 0.2) * 1000);
  }

  dispose() {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.ready = false;
  }
}
