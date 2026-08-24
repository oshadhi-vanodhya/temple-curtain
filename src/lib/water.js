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
 *
 * The water is heard from inside a temple, not standing at the fall, and two
 * things carry that. It is set in a stone room of its own — a short, dark
 * convolution, quite unlike the chime's hall — so it arrives with walls around
 * it rather than in the open. And the spray band is pulled well down: close water
 * is bright and hissing, while water heard across a courtyard has lost its top
 * end to the air and the walls long before it reaches you.
 *
 * It is deliberately dark almost to the point of being felt rather than heard.
 * Broadband noise above roughly a kilohertz is what the ear reads as hiss, and
 * hiss is the opposite of calming however quiet it is — so the whole bed passes
 * through a pair of cascaded low-passes that take the top off before anything
 * else happens. What is left is closer to a slow burble than to a fall.
 *
 * Over that bed fall occasional drops into standing water. A real drip is not a
 * click: it is the resonance of the bubble the drop leaves behind, which shrinks
 * as it collapses, so the pitch *rises* over the few tens of milliseconds it
 * sounds. Sweeping it upward is what separates a drip from a tap. They are sent
 * mostly to the room, so each one answers from the stonework.
 */

/** A short, dark room — stone and timber rather than a hall. */
function buildRoomImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // One-pole lowpass on the noise darkens the tail, the way soft furnishings
      // and open air take the top off real reflections.
      lp += ((Math.random() * 2 - 1) - lp) * 0.34;
      data[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return impulse;
}

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
    this.disposed = false;

    // A small dark room: stone and timber, not a cathedral.
    const room = ctx.createConvolver();
    room.buffer = buildRoomImpulse(ctx, 2.2, 3.4);
    const roomLevel = ctx.createGain();
    roomLevel.gain.value = 0.9;
    room.connect(roomLevel);
    this.room = room;

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
    rush.frequency.value = 680;
    rush.Q.value = 0.8;
    const rushGain = ctx.createGain();
    rushGain.gain.value = 0.22;

    const spray = ctx.createBiquadFilter();
    spray.type = "highpass";
    spray.frequency.value = 3400;
    spray.Q.value = 0.5;
    const sprayGain = ctx.createGain();
    // Barely there. This band is the hiss, and cutting it to nothing leaves a
    // dull hum rather than water — it survives only as a hint of air.
    sprayGain.gain.value = 0.022;

    // Two gentle low-passes in series rather than one steep filter: a single
    // pole leaves too much hiss, and a resonant filter would ring on the noise
    // and sing. Cascading two shallow ones rolls the top off smoothly.
    const veilA = ctx.createBiquadFilter();
    veilA.type = "lowpass";
    veilA.frequency.value = 940;
    veilA.Q.value = 0.5;
    const veilB = ctx.createBiquadFilter();
    veilB.type = "lowpass";
    veilB.frequency.value = 1700;
    veilB.Q.value = 0.5;

    // Body and rush are what carry the hiss, so only those two are veiled.
    for (const [filter, gain] of [[body, bodyGain], [rush, rushGain]]) {
      source.connect(filter);
      filter.connect(gain);
      gain.connect(veilA);
    }
    veilA.connect(veilB);
    veilB.connect(panner);

    // The spray band skips the veil and goes straight through. Routed into it,
    // the low-passes erase it completely and the bed becomes a dull hum with no
    // sense of air at all; kept separate and very quiet, it reads as the faint
    // sheen above water without bringing the hiss back.
    source.connect(spray);
    spray.connect(sprayGain);
    sprayGain.connect(panner);
    panner.connect(this.out);

    // Most of the bed is heard through the room rather than directly.
    const dry = ctx.createGain();
    dry.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 1.0;
    this.out.connect(dry);
    this.out.connect(wet);
    wet.connect(room);
    dry.connect(destination);
    roomLevel.connect(destination);

    // Drips are almost entirely reflected sound.
    this.dripBus = ctx.createGain();
    this.dripBus.gain.value = 1;
    const dripDry = ctx.createGain();
    dripDry.gain.value = 0.3;
    this.dripBus.connect(dripDry);
    this.dripBus.connect(room);
    dripDry.connect(destination);

    this.nodes.push(room, roomLevel, dry, wet, this.dripBus, dripDry);

    // Unrelated rates on purpose: shared or harmonically related ones would beat
    // together into an audible pulse.
    this.#drift(0.017, 120, body.frequency);
    this.#drift(0.023, 0.09, rushGain.gain);
    this.#drift(0.011, 320, rush.frequency);
    this.#drift(0.037, 0.004, sprayGain.gain);
    this.#drift(0.008, 0.05, this.out.gain);

    source.start();
    this.source = source;
    this.#scheduleDrips();
    this.nodes.push(source, panner, body, bodyGain, rush, rushGain, spray, sprayGain, veilA, veilB);
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

  /** One drop into standing water: a bubble resonance, rising as it collapses. */
  #drip() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const f0 = 560 + Math.random() * 620;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(f0 * (1.7 + Math.random() * 0.7), now + 0.05 + Math.random() * 0.03);

    const g = ctx.createGain();
    const peak = 0.022 + Math.random() * 0.026;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + Math.random() * 0.14);

    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.55 + Math.random() * 0.35;

    osc.connect(g);
    g.connect(pan);
    pan.connect(this.dripBus);
    osc.start(now);
    osc.stop(now + 0.4);
    osc.onended = () => {
      g.disconnect();
      pan.disconnect();
    };
  }

  #scheduleDrips() {
    const tick = () => {
      if (this.disposed) return;
      this.#drip();
      // Irregular on purpose: an even cadence reads as a metronome, not a leak.
      this.dripTimer = setTimeout(tick, 7000 + Math.random() * 13000);
    };
    this.dripTimer = setTimeout(tick, 4000 + Math.random() * 6000);
  }

  /** Fade to a level over `seconds`; the water should never simply appear. */
  fadeTo(level, seconds = 4) {
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(level, now + seconds);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.dripTimer);
    try {
      this.source.stop();
    } catch {
      // already stopped
    }
    for (const n of this.nodes) n.disconnect();
    this.out.disconnect();
  }
}
