import type { AudioUnit } from '../../lib/types';
import { clamp, dbToGain } from '../../lib/units';
import { ensureCaptureWorklet } from '../captureWorklet';
import { looperService } from '../looperService';
import { mediaCache, micManager } from '../mediaCache';
import { recorderService } from '../recorderService';
import { transportService } from '../transportService';
import { triggerBus } from '../triggerBus';

const SMOOTH = 0.01; // 10 ms setTargetAtTime — click-free param moves

function makeAnalyser(ctx: AudioContext, fftSize = 512): AnalyserNode {
  const an = ctx.createAnalyser();
  an.fftSize = fftSize;
  an.smoothingTimeConstant = 0;
  return an;
}

const setNow = (p: AudioParam, v: number, ctx: AudioContext) =>
  p.setTargetAtTime(v, ctx.currentTime, SMOOTH);

/* ================================================================ sources */

export function createSignalGen(ctx: AudioContext): AudioUnit {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 440;
  const level = ctx.createGain();
  level.gain.value = dbToGain(-20);
  const pitchScale = ctx.createGain();
  pitchScale.gain.value = 2400;
  const an = makeAnalyser(ctx);
  
  pitchScale.connect(osc.detune);
  osc.connect(level);
  level.connect(an);
  osc.start();

  const waves: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];

  return {
    inputs: { pitch: pitchScale },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'freq') setNow(osc.frequency, v, ctx);
      if (id === 'level') setNow(level.gain, dbToGain(v), ctx);
      if (id === 'wave') osc.type = waves[clamp(Math.round(v), 0, 3)];
      if (id === 'pitchAmt') setNow(pitchScale.gain, v, ctx);
    },
    dispose() {
      try {
        osc.stop();
      } catch {
        /* noop */
      }
      osc.disconnect();
      pitchScale.disconnect();
      level.disconnect();
      an.disconnect();
    },
  };
}

/* noise — shared buffers per context+type */
const noiseCache = new WeakMap<AudioContext, Map<string, AudioBuffer>>();

function noiseBuffer(ctx: AudioContext, type: 'pink' | 'white'): AudioBuffer {
  let byType = noiseCache.get(ctx);
  if (!byType) {
    byType = new Map();
    noiseCache.set(ctx, byType);
  }
  const hit = byType.get(type);
  if (hit) return hit;

  const seconds = 4;
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (type === 'white') {
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } else {
    // Paul Kellet pink filter
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  byType.set(type, buf);
  return buf;
}

export function createNoiseGen(ctx: AudioContext): AudioUnit {
  const level = ctx.createGain();
  level.gain.value = dbToGain(-20);
  const an = makeAnalyser(ctx);
  level.connect(an);

  let src: AudioBufferSourceNode | null = null;
  let currentType: 'pink' | 'white' = 'pink';
  let disposed = false;

  const spin = (type: 'pink' | 'white') => {
    if (disposed) return;
    try {
      src?.stop();
    } catch {
      /* noop */
    }
    src?.disconnect();
    src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, type);
    src.loop = true;
    src.connect(level);
    src.start();
    currentType = type;
  };
  spin('pink');

  return {
    inputs: {},
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'level') setNow(level.gain, dbToGain(v), ctx);
      if (id === 'type') {
        const next = Math.round(v) === 1 ? 'white' : 'pink';
        if (next !== currentType) spin(next);
      }
    },
    dispose() {
      disposed = true;
      try {
        src?.stop();
      } catch {
        /* noop */
      }
      src?.disconnect();
      level.disconnect();
      an.disconnect();
    },
  };
}

export function createMediaPlayer(ctx: AudioContext, nodeId: string): AudioUnit {
  const level = ctx.createGain();
  level.gain.value = dbToGain(-6);
  const an = makeAnalyser(ctx);
  level.connect(an);

  let src: AudioBufferSourceNode | null = null;
  let playing = false;
  let looping = true;
  let disposed = false;

  const stop = () => {
    try {
      src?.stop();
    } catch {
      /* noop */
    }
    src?.disconnect();
    src = null;
  };

  const play = () => {
    if (disposed) return;
    stop();
    const entry = mediaCache.get(nodeId);
    if (!entry) return; // nothing loaded yet
    src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.loop = looping;
    src.onended = () => {
      if (!looping) playing = false;
    };
    src.connect(level);
    src.start();
  };

  return {
    inputs: {},
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'level') setNow(level.gain, dbToGain(v), ctx);
      if (id === 'loop') {
        looping = v > 0.5;
        if (src) src.loop = looping;
      }
      if (id === 'play') {
        const want = v > 0.5;
        if (want && !playing) {
          playing = true;
          play();
        } else if (!want && playing) {
          playing = false;
          stop();
        } else if (want && playing && !src) {
          play(); // file arrived after play was switched on
        }
      }
    },
    dispose() {
      disposed = true;
      stop();
      level.disconnect();
      an.disconnect();
    },
  };
}

export function createMicIn(ctx: AudioContext): AudioUnit {
  const enable = ctx.createGain();
  enable.gain.value = 0;
  const level = ctx.createGain();
  level.gain.value = dbToGain(-6);
  const an = makeAnalyser(ctx);
  enable.connect(level);
  level.connect(an);

  let source: MediaStreamAudioSourceNode | null = null;
  let disposed = false;

  const attach = () => {
    if (disposed || source || !micManager.stream) return;
    source = ctx.createMediaStreamSource(micManager.stream);
    source.connect(enable);
  };
  attach(); // stream may already be granted from a previous session

  return {
    inputs: {},
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'level') setNow(level.gain, dbToGain(v), ctx);
      if (id === 'enable') {
        const on = v > 0.5;
        setNow(enable.gain, on ? 1 : 0, ctx);
        if (on && !source) {
          micManager
            .request()
            .then(attach)
            .catch(() => {
              /* toast handled by micManager.onDenied */
            });
        }
      }
    },
    dispose() {
      disposed = true;
      source?.disconnect();
      enable.disconnect();
      level.disconnect();
      an.disconnect();
    },
  };
}

export function createSampler(ctx: AudioContext, nodeId: string): AudioUnit {
  const level = ctx.createGain();
  level.gain.value = dbToGain(-6);
  const an = makeAnalyser(ctx);
  level.connect(an);

  const pitchScale = ctx.createGain();
  pitchScale.gain.value = 2400; // default pitchAmt

  let tuneCents = 0;
  let choke = true;
  let disposed = false;

  type SamplerVoice = {
    source: AudioBufferSourceNode;
    hitGain: GainNode;
    cleaned: boolean;
  };

  const activeSet = new Set<SamplerVoice>();

  const cleanupVoice = (voice: SamplerVoice) => {
    if (voice.cleaned) return;
    voice.cleaned = true;
    try { pitchScale.disconnect(voice.source.detune); } catch {}
    try { voice.source.disconnect(); } catch {}
    try { voice.hitGain.disconnect(); } catch {}
    activeSet.delete(voice);
  };

  const stopActive = () => {
    const t = ctx.currentTime;
    const voices = Array.from(activeSet);
    activeSet.clear();

    for (const voice of voices) {
      try {
        voice.hitGain.gain.setTargetAtTime(0, t, 0.003);
        voice.source.stop(t + 0.01);
        window.setTimeout(() => cleanupVoice(voice), 50);
      } catch {
        cleanupVoice(voice);
      }
    }
  };

  const onTransportStop = () => stopActive();
  transportService.onTransportStop(onTransportStop);

  const spawn = (time: number) => {
    if (disposed) return;
    const entry = mediaCache.get(nodeId);
    if (!entry) return;
    
    if (choke) stopActive();
    
    const src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.detune.value = tuneCents;
    const hitGain = ctx.createGain();
    hitGain.gain.value = 1;
    const voice: SamplerVoice = { source: src, hitGain, cleaned: false };
    
    pitchScale.connect(src.detune);
    src.connect(hitGain);
    hitGain.connect(level);
    
    src.onended = () => cleanupVoice(voice);
    
    activeSet.add(voice);
    src.start(time);
  };

  return {
    inputs: { pitch: pitchScale },
    outputs: { out: an },
    analysers: { out: an },
    triggerIns: {
      trig: (time) => spawn(time ?? ctx.currentTime),
    },
    bind(id, v) {
      if (id === 'level') setNow(level.gain, dbToGain(v), ctx);
      if (id === 'tune') tuneCents = v * 100;
      if (id === 'pitchAmt') setNow(pitchScale.gain, v, ctx);
      if (id === 'choke') choke = v > 0.5;
    },
    dispose() {
      disposed = true;
      transportService.offTransportStop(onTransportStop);
      for (const voice of activeSet) {
        try { voice.source.stop(); } catch {}
        cleanupVoice(voice);
      }
      activeSet.clear();
      pitchScale.disconnect();
      level.disconnect();
      an.disconnect();
    },
  };
}

/* ============================================================= modulation */

export function createLFO(ctx: AudioContext): AudioUnit {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 2;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  const an = makeAnalyser(ctx);
  osc.connect(depth);
  depth.connect(an);
  osc.start();

  const waves: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];

  return {
    inputs: {},
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'rate') setNow(osc.frequency, v, ctx);
      if (id === 'depth') setNow(depth.gain, v / 100, ctx);
      if (id === 'wave') osc.type = waves[clamp(Math.round(v), 0, 3)];
    },
    dispose() {
      try {
        osc.stop();
      } catch {
        /* noop */
      }
      osc.disconnect();
      depth.disconnect();
      an.disconnect();
    },
  };
}

/* ==================================================================== dsp */

export function createGain(ctx: AudioContext): AudioUnit {
  const g = ctx.createGain();
  g.gain.value = 1;
  const mute = ctx.createGain();
  mute.gain.value = 1;
  const an = makeAnalyser(ctx);
  g.connect(mute);
  mute.connect(an);

  // control input: LFO (±depth) -> modScale -> adds to gain.gain
  const modScale = ctx.createGain();
  modScale.gain.value = 0;
  modScale.connect(g.gain);

  return {
    inputs: { in: g, mod: modScale },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'gain') setNow(g.gain, dbToGain(v), ctx);
      if (id === 'mute') setNow(mute.gain, v > 0.5 ? 0 : 1, ctx);
      if (id === 'modAmt') setNow(modScale.gain, v / 100, ctx); // ±1 lin @ 100%
    },
    dispose() {
      g.disconnect();
      mute.disconnect();
      an.disconnect();
      modScale.disconnect();
    },
  };
}

export function createFilter(ctx: AudioContext): AudioUnit {
  const biquad = ctx.createBiquadFilter();
  biquad.type = 'lowpass';
  biquad.frequency.value = 1000;
  biquad.Q.value = 0.9;
  const an = makeAnalyser(ctx);
  biquad.connect(an);

  // control input modulates detune: ±2400 cents (±2 octaves) at 100 %
  const modScale = ctx.createGain();
  modScale.gain.value = 0;
  modScale.connect(biquad.detune);

  const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

  return {
    inputs: { in: biquad, mod: modScale },
    outputs: { out: an },
    analysers: { out: an },
    eqFilters: [biquad],
    bind(id, v) {
      if (id === 'freq') setNow(biquad.frequency, v, ctx);
      if (id === 'q') setNow(biquad.Q, v, ctx);
      if (id === 'type') biquad.type = types[clamp(Math.round(v), 0, 3)];
      if (id === 'modAmt') setNow(modScale.gain, (v / 100) * 2400, ctx);
    },
    dispose() {
      biquad.disconnect();
      an.disconnect();
      modScale.disconnect();
    },
  };
}

export function createPEQ(ctx: AudioContext): AudioUnit {
  const ls = ctx.createBiquadFilter();
  ls.type = 'lowshelf';
  ls.frequency.value = 120;
  const p1 = ctx.createBiquadFilter();
  p1.type = 'peaking';
  p1.frequency.value = 500;
  p1.Q.value = 1;
  const p2 = ctx.createBiquadFilter();
  p2.type = 'peaking';
  p2.frequency.value = 2500;
  p2.Q.value = 1;
  const hs = ctx.createBiquadFilter();
  hs.type = 'highshelf';
  hs.frequency.value = 8000;
  const an = makeAnalyser(ctx);
  ls.connect(p1);
  p1.connect(p2);
  p2.connect(hs);
  hs.connect(an);

  return {
    inputs: { in: ls },
    outputs: { out: an },
    analysers: { out: an },
    eqFilters: [ls, p1, p2, hs],
    bind(id, v) {
      switch (id) {
        case 'lsFreq':
          return setNow(ls.frequency, v, ctx);
        case 'lsGain':
          return setNow(ls.gain, v, ctx);
        case 'b1Freq':
          return setNow(p1.frequency, v, ctx);
        case 'b1Gain':
          return setNow(p1.gain, v, ctx);
        case 'b1Q':
          return setNow(p1.Q, v, ctx);
        case 'b2Freq':
          return setNow(p2.frequency, v, ctx);
        case 'b2Gain':
          return setNow(p2.gain, v, ctx);
        case 'b2Q':
          return setNow(p2.Q, v, ctx);
        case 'hsFreq':
          return setNow(hs.frequency, v, ctx);
        case 'hsGain':
          return setNow(hs.gain, v, ctx);
      }
    },
    dispose() {
      ls.disconnect();
      p1.disconnect();
      p2.disconnect();
      hs.disconnect();
      an.disconnect();
    },
  };
}

export function createCompressor(ctx: AudioContext): AudioUnit {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.01;
  comp.release.value = 0.15;
  const makeup = ctx.createGain();
  makeup.gain.value = 1;
  const an = makeAnalyser(ctx);
  comp.connect(makeup);
  makeup.connect(an);

  return {
    inputs: { in: comp },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'threshold') setNow(comp.threshold, v, ctx);
      if (id === 'ratio') setNow(comp.ratio, v, ctx);
      if (id === 'attack') setNow(comp.attack, v / 1000, ctx); // ms -> s
      if (id === 'release') setNow(comp.release, v / 1000, ctx);
      if (id === 'knee') setNow(comp.knee, v, ctx);
      if (id === 'makeup') setNow(makeup.gain, dbToGain(v), ctx);
    },
    dispose() {
      comp.disconnect();
      makeup.disconnect();
      an.disconnect();
    },
  };
}

export function createStepSequencer(ctx: AudioContext, nodeId: string): AudioUnit {
  const pattern = Array.from({ length: 4 }, () => new Array(16).fill(0));
  let steps = 16;
  let rateDiv = 2; // 1/8 default
  let pos = 0;

  const onTick = (time: number, tickIndex: number) => {
    if (tickIndex % rateDiv !== 0) return;
    const step = pos % steps;
    pos = (step + 1) % steps;
    
    for (let row = 0; row < 4; row++) {
      if (pattern[row][step] === 1) {
        triggerBus.emit(nodeId, `row${row + 1}`, time);
      }
    }
    
    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
    const event = new CustomEvent('pl-seq-step', { 
      detail: { nodeId, step, delayMs } 
    });
    window.dispatchEvent(event);
  };
  
  const onStop = () => {
    pos = 0;
    window.dispatchEvent(new CustomEvent('pl-seq-stop', { detail: { nodeId } }));
  };

  transportService.registerSequencer(nodeId, onTick);
  transportService.onTransportStop(onStop);

  return {
    inputs: {},
    outputs: {},
    analysers: {},
    triggerIns: {},
    bind(id, v) {
      if (id === 'steps') {
        steps = Math.max(1, Math.min(16, Math.round(v)));
        pos = pos % steps;
      }
      else if (id === 'rate') rateDiv = Math.round(v) === 0 ? 2 : 1;
      else if (id.startsWith('s')) {
        const m = id.match(/s(\d)_(\d+)/);
        if (m) {
          const row = parseInt(m[1], 10) - 1;
          const col = parseInt(m[2], 10) - 1;
          if (row >= 0 && row < 4 && col >= 0 && col < 16) {
            pattern[row][col] = v;
          }
        }
      }
    },
    dispose() {
      transportService.unregister(nodeId);
      transportService.offTransportStop(onStop);
    },
  };
}

export function createDelay(ctx: AudioContext): AudioUnit {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(2.0);
  delay.delayTime.value = 0.25;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.3;
  const sum = ctx.createGain();
  const an = makeAnalyser(ctx);

  input.connect(dry);
  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  dry.connect(sum);
  wet.connect(sum);
  sum.connect(an);
  dry.gain.value = 0.7;
  wet.gain.value = 0.3;

  // control input modulates delay time: ±10 ms at 100 % (chorus/vibrato)
  const modScale = ctx.createGain();
  modScale.gain.value = 0;
  modScale.connect(delay.delayTime);

  return {
    inputs: { in: input, mod: modScale },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'time') setNow(delay.delayTime, v / 1000, ctx);
      if (id === 'feedback') setNow(feedback.gain, clamp(v / 100, 0, 0.95), ctx);
      if (id === 'mix') {
        const m = clamp(v / 100, 0, 1);
        setNow(dry.gain, 1 - m, ctx);
        setNow(wet.gain, m, ctx);
      }
      if (id === 'modAmt') setNow(modScale.gain, (v / 100) * 0.01, ctx);
    },
    dispose() {
      input.disconnect();
      dry.disconnect();
      wet.disconnect();
      delay.disconnect();
      feedback.disconnect();
      sum.disconnect();
      an.disconnect();
      modScale.disconnect();
    },
  };
}

/* synthesized exponential-decay impulse response */
function makeIR(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
  }
  return buf;
}

export function createReverb(ctx: AudioContext): AudioUnit {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = makeIR(ctx, 2);
  const sum = ctx.createGain();
  const an = makeAnalyser(ctx);

  input.connect(dry);
  input.connect(conv);
  conv.connect(wet);
  dry.connect(sum);
  wet.connect(sum);
  sum.connect(an);
  dry.gain.value = 0.7;
  wet.gain.value = 0.3;

  let irTimer: number | undefined;
  let disposed = false;

  return {
    inputs: { in: input },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'decay') {
        // IR regeneration is heavier than a param write — debounce it
        window.clearTimeout(irTimer);
        irTimer = window.setTimeout(() => {
          if (!disposed) conv.buffer = makeIR(ctx, clamp(v, 0.1, 8));
        }, 150);
      }
      if (id === 'mix') {
        const m = clamp(v / 100, 0, 1);
        setNow(dry.gain, 1 - m, ctx);
        setNow(wet.gain, m, ctx);
      }
    },
    dispose() {
      disposed = true;
      window.clearTimeout(irTimer);
      input.disconnect();
      dry.disconnect();
      wet.disconnect();
      conv.disconnect();
      sum.disconnect();
      an.disconnect();
    },
  };
}

function shaperCurve(drive: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = Math.max(1, drive);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

export function createDistortion(ctx: AudioContext): AudioUnit {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = shaperCurve(4);
  shaper.oversample = '2x';
  const wet = ctx.createGain();
  const level = ctx.createGain();
  const an = makeAnalyser(ctx);

  input.connect(dry);
  input.connect(shaper);
  shaper.connect(wet);
  dry.connect(level);
  wet.connect(level);
  level.connect(an);
  dry.gain.value = 0;
  wet.gain.value = 1;
  level.gain.value = dbToGain(-3);

  let curveTimer: number | undefined;
  let disposed = false;

  return {
    inputs: { in: input },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'drive') {
        window.clearTimeout(curveTimer);
        curveTimer = window.setTimeout(() => {
          if (!disposed) shaper.curve = shaperCurve(v);
        }, 60);
      }
      if (id === 'mix') {
        const m = clamp(v / 100, 0, 1);
        setNow(dry.gain, 1 - m, ctx);
        setNow(wet.gain, m, ctx);
      }
      if (id === 'level') setNow(level.gain, dbToGain(v), ctx);
    },
    dispose() {
      disposed = true;
      window.clearTimeout(curveTimer);
      input.disconnect();
      dry.disconnect();
      shaper.disconnect();
      wet.disconnect();
      level.disconnect();
      an.disconnect();
    },
  };
}

export function createPanner(ctx: AudioContext): AudioUnit {
  const pan = ctx.createStereoPanner();
  const an = makeAnalyser(ctx);
  pan.connect(an);

  const modScale = ctx.createGain();
  modScale.gain.value = 0;
  modScale.connect(pan.pan);

  return {
    inputs: { in: pan, mod: modScale },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      if (id === 'pan') setNow(pan.pan, clamp(v / 100, -1, 1), ctx);
      if (id === 'modAmt') setNow(modScale.gain, v / 100, ctx);
    },
    dispose() {
      pan.disconnect();
      an.disconnect();
      modScale.disconnect();
    },
  };
}

/* ================================================================ routing */

export function createMixer(ctx: AudioContext): AudioUnit {
  const ins = [0, 1, 2, 3].map(() => {
    const g = ctx.createGain();
    g.gain.value = 1;
    return g;
  });
  const sum = ctx.createGain();
  sum.gain.value = 1;
  const an = makeAnalyser(ctx);
  ins.forEach((g) => g.connect(sum));
  sum.connect(an);

  return {
    inputs: { in1: ins[0], in2: ins[1], in3: ins[2], in4: ins[3] },
    outputs: { out: an },
    analysers: { out: an },
    bind(id, v) {
      const m = /^lvl([1-4])$/.exec(id);
      if (m) setNow(ins[Number(m[1]) - 1].gain, dbToGain(v), ctx);
      if (id === 'master') setNow(sum.gain, dbToGain(v), ctx);
    },
    dispose() {
      ins.forEach((g) => g.disconnect());
      sum.disconnect();
      an.disconnect();
    },
  };
}

export function createRouter(ctx: AudioContext): AudioUnit {
  const ins = [0, 1, 2, 3].map(() => ctx.createGain());
  const outs = [0, 1, 2, 3].map(() => ctx.createGain());
  const ans = outs.map(() => makeAnalyser(ctx));
  // 16 crosspoints, in -> cross -> out
  const cross: GainNode[][] = ins.map((inG, i) =>
    outs.map((outG, o) => {
      const x = ctx.createGain();
      x.gain.value = i === o ? 1 : 0; // default: straight-through
      inG.connect(x);
      x.connect(outG);
      return x;
    }),
  );
  outs.forEach((g, i) => g.connect(ans[i]));

  return {
    inputs: { in1: ins[0], in2: ins[1], in3: ins[2], in4: ins[3] },
    outputs: { out1: ans[0], out2: ans[1], out3: ans[2], out4: ans[3] },
    analysers: { out1: ans[0], out2: ans[1], out3: ans[2], out4: ans[3] },
    bind(id, v) {
      const m = /^r([1-4])([1-4])$/.exec(id);
      if (m) {
        const i = Number(m[1]) - 1;
        const o = Number(m[2]) - 1;
        setNow(cross[i][o].gain, v > 0.5 ? 1 : 0, ctx);
      }
    },
    dispose() {
      ins.forEach((g) => g.disconnect());
      outs.forEach((g) => g.disconnect());
      ans.forEach((a) => a.disconnect());
      cross.forEach((row) => row.forEach((x) => x.disconnect()));
    },
  };
}

/* =============================================================== metering */

export function createAnalyzer(ctx: AudioContext): AudioUnit {
  const input = ctx.createGain();
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  an.smoothingTimeConstant = 0.8; // affects frequency data only
  input.connect(an);

  return {
    inputs: { in: input },
    outputs: { out: an },
    analysers: { out: an },
    scope: an,
    bind() {
      /* display-only params are read by the scope service */
    },
    dispose() {
      input.disconnect();
      an.disconnect();
    },
  };
}

export function createLooper(ctx: AudioContext, nodeId: string): AudioUnit {
  const input = ctx.createGain();
  const thruGain = ctx.createGain();
  const loopGain = ctx.createGain();
  const an = makeAnalyser(ctx);
  const speeds = [0.5, 1, 2];
  let disposed = false;
  
  input.connect(thruGain);
  thruGain.connect(an);
  loopGain.connect(an);

  looperService.ensureEntry(ctx, nodeId).then((entry) => {
    if (disposed) return;
    input.connect(entry.tap.node);
    entry.bus.connect(loopGain);
  });

  return {
    inputs: { in: input },
    outputs: { out: an },
    analysers: { out: an },
    bind(paramId: string, value: number) {
      if (paramId === 'thruLevel') thruGain.gain.setTargetAtTime(dbToGain(value), ctx.currentTime, 0.02);
      if (paramId === 'loopLevel') loopGain.gain.setTargetAtTime(dbToGain(value), ctx.currentTime, 0.02);
      if (paramId === 'sync') looperService.setSync(nodeId, value > 0.5);
      if (paramId === 'speed') looperService.setSpeed(nodeId, speeds[clamp(Math.round(value), 0, speeds.length - 1)]);
    },
    dispose() {
      disposed = true;
      try {
        const tap = looperService.getTap(ctx, nodeId);
        if (tap) input.disconnect(tap.node);
        const bus = looperService.getPlaybackBus(ctx, nodeId);
        if (bus) bus.disconnect(loopGain);
      } catch {}
      input.disconnect();
      thruGain.disconnect();
      loopGain.disconnect();
      an.disconnect();
    }
  };
}

/* ================================================================= output */

export function createRecorder(ctx: AudioContext, nodeId: string): AudioUnit {
  const input = ctx.createGain();
  const an = makeAnalyser(ctx);
  let disposed = false;
  input.connect(an);

  ensureCaptureWorklet(ctx).then(() => {
    if (disposed) return;
    const dest = recorderService.getDest(ctx, nodeId);
    const tap = recorderService.getTap(ctx, nodeId);
    input.connect(dest);
    input.connect(tap.node);
  });

  return {
    inputs: { in: input },
    outputs: { out: an },
    analysers: { out: an },
    bind() {},
    dispose() {
      disposed = true;
      try {
        const dest = recorderService.getDest(ctx, nodeId);
        input.disconnect(dest);
      } catch {}
      try {
        const tap = recorderService.getTap(ctx, nodeId);
        input.disconnect(tap.node);
      } catch {}
      input.disconnect(an);
      an.disconnect();
    },
  };
}

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
      if (id === 'level') setNow(level.gain, dbToGain(v), ctx);
    },
    dispose() {
      level.disconnect();
      an.disconnect();
      limiter.disconnect();
    },
  };
}

/* ================================================================ triggers */

export function createTriggerPad(): AudioUnit {
  return {
    inputs: {},
    outputs: {},
    analysers: {},
    triggerIns: {}, // it emits, it doesn't receive
    bind() {},
    dispose() {},
  };
}

export function createEnvelope(ctx: AudioContext): AudioUnit {
  const src = ctx.createConstantSource();
  src.offset.value = 1;
  src.start();
  const env = ctx.createGain();
  env.gain.value = 0;
  src.connect(env);
  const an = makeAnalyser(ctx);
  env.connect(an);

  let attackS = 0.001;
  let decayS = 0.2;
  let exponential = true;

  const fire = (time?: number) => {
    const t = time ?? ctx.currentTime;
    const g = env.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t); // retrigger-safe: start ramp from CURRENT value, not stale target
    g.linearRampToValueAtTime(1, t + attackS);
    if (exponential) {
      g.setTargetAtTime(0, t + attackS, decayS / 3); // setTargetAtTime never reaches exactly 0, /3 approximates a natural decay-to-silence within decayS
    } else {
      g.linearRampToValueAtTime(0, t + attackS + decayS);
    }
  };

  return {
    inputs: {},
    outputs: { out: an },
    analysers: { out: an },
    triggerIns: { trig: fire },
    bind(id, v) {
      if (id === 'attack') attackS = v / 1000;
      if (id === 'decay') decayS = v / 1000;
      if (id === 'curve') exponential = Math.round(v) === 0;
    },
    dispose() {
      try { src.stop(); } catch {}
      src.disconnect();
      env.disconnect();
      an.disconnect();
    },
  };
}
