/**
 * The sound of the painted waterfall: faint, continuous, and entirely
 * synthesised.
 *
 * Falling water has no pitch — it is broadband noise shaped by the size of the
 * drops and the space around them. So unlike the chime, which is built from
 * partials, this starts as pink noise and is carved into three bands:
 *
 *   - a low body, the weight of water hitting the pool
 *   - a mid rush, the bulk of the fall
 *   - a high sparkle, the spray coming off it
 *
 * What stops it sounding like a hiss is that none of those bands hold still.
 * Slow oscillators, all at different and unrelated rates, drift the filter
 * frequencies and band levels against each other, so the texture keeps shifting
 * and never settles into a recognisable loop.
 *
 * Pink rather than white noise because white noise puts equal energy in every
 * hertz, which our hearing reads as a bright electronic hiss; pink falls off
 * with frequency the way natural broadband sound does.
 */

/** Paul Kellett's pink-noise filter — white noise shaped to -3dB per octave. */
function fillPink(data) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

/**
 * Splice the tail into the head so the loop point is inaudible. Without this a
 * looping noise buffer ticks once per cycle, which is the one cue that gives
 * away a recording as a loop.
 */
function crossfadeEnds(data, fadeSamples) {
  const n = data.length;
  for (let i = 0; i < fadeSamples; i++) {
    const t = i / fadeSamples;
    data[i] = data[i] * t + data[n - fadeSamples + i] * (1 - t);
  }
}

export class Water {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination usually a dry bus, not the reverb send
   */
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.nodes = [];

    const seconds = 8;
    const fade = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      fillPink(data);
      crossfadeEnds(data, fade);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    this.out = ctx.createGain();
    this.out.gain.value = 0;

    // The painted fall sits on the left of the frame, so the water sits there too.
    const panner = ctx.createStereoPanner();
    panner.pan.value = -0.4;

    const body = ctx.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.value = 420;
    body.Q.value = 0.7;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.9;

    const rush = ctx.createBiquadFilter();
    rush.type = "bandpass";
    rush.frequency.value = 1100;
    rush.Q.value = 0.6;
    const rushGain = ctx.createGain();
    rushGain.gain.value = 0.5;

    const spray = ctx.createBiquadFilter();
    spray.type = "highpass";
    spray.frequency.value = 3400;
    spray.Q.value = 0.5;
    const sprayGain = ctx.createGain();
    sprayGain.gain.value = 0.14;

    for (const [filter, gain] of [[body, bodyGain], [rush, rushGain], [spray, sprayGain]]) {
      source.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
    }
    panner.connect(this.out);
    this.out.connect(destination);

    // Unrelated rates on purpose: shared or harmonically related ones would beat
    // together into an audible pulse.
    this.#drift(0.031, 260, body.frequency);
    this.#drift(0.047, 0.22, rushGain.gain);
    this.#drift(0.019, 900, rush.frequency);
    this.#drift(0.073, 0.07, sprayGain.gain);
    this.#drift(0.013, 0.12, this.out.gain);

    source.start();
    this.source = source;
    this.nodes.push(source, panner, body, bodyGain, rush, rushGain, spray, sprayGain);
  }

  /** A slow sine riding on an AudioParam, added to whatever else drives it. */
  #drift(hz, depth, param) {
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = hz;
    const amount = this.ctx.createGain();
    amount.gain.value = depth;
    lfo.connect(amount);
    amount.connect(param);
    lfo.start();
    this.nodes.push(lfo, amount);
  }

  /** Fade to a level over `seconds`; the water should never simply appear. */
  fadeTo(level, seconds = 4) {
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(level, now + seconds);
  }

  dispose() {
    try {
      this.source.stop();
    } catch {
      // already stopped
    }
    for (const n of this.nodes) n.disconnect();
    this.out.disconnect();
  }
}
