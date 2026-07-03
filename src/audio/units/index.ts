import type { AudioUnit } from '../../lib/types';
import { dbToGain } from '../../lib/units';

const SMOOTH = 0.01; // 10 ms setTargetAtTime — click-free param moves

function makeAnalyser(ctx: AudioContext): AnalyserNode {
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  an.smoothingTimeConstant = 0;
  return an;
}

/* ---------------------------------------------------------------- sine */

export function createSineGen(ctx: AudioContext): AudioUnit {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 440;
  const level = ctx.createGain();
  level.gain.value = dbToGain(-20);
  const an = makeAnalyser(ctx);
  osc.connect(level);
  level.connect(an);
  osc.start();

  return {
    inputs: {},
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      const t = ctx.currentTime;
      if (id === 'freq') osc.frequency.setTargetAtTime(v, t, SMOOTH);
      if (id === 'level') level.gain.setTargetAtTime(dbToGain(v), t, SMOOTH);
    },
    dispose() {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      osc.disconnect();
      level.disconnect();
      an.disconnect();
    },
  };
}

/* ---------------------------------------------------------------- pink */

// One shared pink-noise buffer per AudioContext (Paul Kellet filter method).
const pinkCache = new WeakMap<AudioContext, AudioBuffer>();

function pinkBuffer(ctx: AudioContext): AudioBuffer {
  const cached = pinkCache.get(ctx);
  if (cached) return cached;
  const seconds = 4;
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
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
  pinkCache.set(ctx, buf);
  return buf;
}

export function createNoiseGen(ctx: AudioContext): AudioUnit {
  const src = ctx.createBufferSource();
  src.buffer = pinkBuffer(ctx);
  src.loop = true;
  const level = ctx.createGain();
  level.gain.value = dbToGain(-20);
  const an = makeAnalyser(ctx);
  src.connect(level);
  level.connect(an);
  src.start();

  return {
    inputs: {},
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'level')
        level.gain.setTargetAtTime(dbToGain(v), ctx.currentTime, SMOOTH);
    },
    dispose() {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      src.disconnect();
      level.disconnect();
      an.disconnect();
    },
  };
}

/* ---------------------------------------------------------------- gain */

export function createGain(ctx: AudioContext): AudioUnit {
  const g = ctx.createGain();
  g.gain.value = 1;
  const mute = ctx.createGain();
  mute.gain.value = 1;
  const an = makeAnalyser(ctx);
  g.connect(mute);
  mute.connect(an);

  return {
    inputs: { in: g },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      const t = ctx.currentTime;
      if (id === 'gain') g.gain.setTargetAtTime(dbToGain(v), t, SMOOTH);
      if (id === 'mute') mute.gain.setTargetAtTime(v > 0.5 ? 0 : 1, t, SMOOTH);
    },
    dispose() {
      g.disconnect();
      mute.disconnect();
      an.disconnect();
    },
  };
}

/* ---------------------------------------------------------- master out */

export function createMasterOut(ctx: AudioContext): AudioUnit {
  const level = ctx.createGain();
  level.gain.value = dbToGain(-6);
  // Meter taps PRE-limiter so you can SEE an overdriven sum...
  const an = makeAnalyser(ctx);
  // ...while the safety limiter guarantees you never HEAR one.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  level.connect(an);
  an.connect(limiter);
  limiter.connect(ctx.destination);

  return {
    inputs: { in: level },
    outputs: {},
    analysers: { main: an },
    bind(id, v) {
      if (id === 'level')
        level.gain.setTargetAtTime(dbToGain(v), ctx.currentTime, SMOOTH);
    },
    dispose() {
      level.disconnect();
      an.disconnect();
      limiter.disconnect();
    },
  };
}
