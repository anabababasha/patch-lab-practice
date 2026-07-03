import type { ComponentSpec, ParamSpec, PinSpec } from '../lib/types';
import {
  createAnalyzer,
  createCompressor,
  createDelay,
  createDistortion,
  createFilter,
  createGain,
  createLFO,
  createMasterOut,
  createMediaPlayer,
  createMicIn,
  createMixer,
  createNoiseGen,
  createPanner,
  createPEQ,
  createReverb,
  createRouter,
  createSignalGen,
} from '../audio/units';

/* ------------------------------------------------------------ helpers */

const aIn = (id: string, label: string): PinSpec => ({
  id,
  label,
  direction: 'in',
  kind: 'audio',
});
const aOut = (id: string, label: string): PinSpec => ({
  id,
  label,
  direction: 'out',
  kind: 'audio',
});
const cIn = (id: string, label: string): PinSpec => ({
  id,
  label,
  direction: 'in',
  kind: 'control',
});
const cOut = (id: string, label: string): PinSpec => ({
  id,
  label,
  direction: 'out',
  kind: 'control',
});

const db = (
  id: string,
  label: string,
  min: number,
  max: number,
  def: number,
): ParamSpec => ({ id, label, unit: 'dB', min, max, step: 0.5, default: def });

const hz = (
  id: string,
  label: string,
  min: number,
  max: number,
  def: number,
): ParamSpec => ({
  id,
  label,
  unit: 'Hz',
  min,
  max,
  step: 1,
  default: def,
  taper: 'log',
});

const pct = (id: string, label: string, def: number): ParamSpec => ({
  id,
  label,
  unit: '%',
  min: 0,
  max: 100,
  step: 1,
  default: def,
});

const toggle = (id: string, label: string, def = 0): ParamSpec => ({
  id,
  label,
  unit: '',
  min: 0,
  max: 1,
  step: 1,
  default: def,
  kind: 'toggle',
});

const select = (
  id: string,
  label: string,
  options: string[],
  def = 0,
): ParamSpec => ({
  id,
  label,
  unit: '',
  min: 0,
  max: options.length - 1,
  step: 1,
  default: def,
  kind: 'select',
  options,
});

/* ------------------------------------------------------------ registry */

export const registry: Record<string, ComponentSpec> = {
  /* ------------------------------------------------------- sources */

  signal_gen: {
    type: 'signal_gen',
    name: 'Signal Generator',
    category: 'source',
    pins: [aOut('out', 'Output')],
    params: [
      select('wave', 'Waveform', ['Sine', 'Square', 'Saw', 'Triangle']),
      hz('freq', 'Frequency', 20, 20000, 440),
      db('level', 'Level', -60, 0, -20),
    ],
    internalRouting: {},
    createAudio: createSignalGen,
  },

  noise_gen: {
    type: 'noise_gen',
    name: 'Noise Generator',
    category: 'source',
    pins: [aOut('out', 'Output')],
    params: [
      select('type', 'Type', ['Pink', 'White']),
      db('level', 'Level', -60, 0, -20),
    ],
    internalRouting: {},
    createAudio: createNoiseGen,
  },

  media_player: {
    type: 'media_player',
    name: 'Media Player',
    category: 'source',
    pins: [aOut('out', 'Output')],
    params: [
      toggle('play', 'Play'),
      toggle('loop', 'Loop', 1),
      db('level', 'Level', -60, 0, -6),
    ],
    internalRouting: {},
    display: 'media',
    createAudio: createMediaPlayer,
  },

  mic_in: {
    type: 'mic_in',
    name: 'Mic Input',
    category: 'source',
    pins: [aOut('out', 'Output')],
    params: [toggle('enable', 'Enable'), db('level', 'Level', -60, 12, -6)],
    internalRouting: {},
    display: 'mic',
    createAudio: createMicIn,
  },

  /* ---------------------------------------------------- modulation */

  lfo: {
    type: 'lfo',
    name: 'LFO',
    category: 'mod',
    pins: [cOut('out', 'Mod Out')],
    params: [
      select('wave', 'Waveform', ['Sine', 'Square', 'Saw', 'Triangle']),
      {
        id: 'rate',
        label: 'Rate',
        unit: 'Hz',
        min: 0.05,
        max: 20,
        step: 0.05,
        default: 2,
        taper: 'log',
      },
      pct('depth', 'Depth', 50),
    ],
    internalRouting: {},
    createAudio: createLFO,
  },

  /* ----------------------------------------------------------- dsp */

  gain: {
    type: 'gain',
    name: 'Gain',
    category: 'dsp',
    pins: [aIn('in', 'Input'), cIn('mod', 'Mod'), aOut('out', 'Output')],
    params: [
      db('gain', 'Gain', -60, 12, 0),
      toggle('mute', 'Mute'),
      pct('modAmt', 'Mod Amt', 0),
    ],
    internalRouting: { in: ['out'], mod: ['out'] },
    createAudio: createGain,
  },

  filter: {
    type: 'filter',
    name: 'Filter',
    category: 'dsp',
    pins: [aIn('in', 'Input'), cIn('mod', 'Mod'), aOut('out', 'Output')],
    params: [
      select('type', 'Type', ['Low-pass', 'High-pass', 'Band-pass', 'Notch']),
      hz('freq', 'Cutoff', 20, 20000, 1000),
      {
        id: 'q',
        label: 'Q',
        unit: '',
        min: 0.1,
        max: 18,
        step: 0.1,
        default: 0.9,
        taper: 'log',
      },
      pct('modAmt', 'Mod Amt', 0),
    ],
    internalRouting: { in: ['out'], mod: ['out'] },
    createAudio: createFilter,
  },

  peq4: {
    type: 'peq4',
    name: 'Parametric EQ',
    category: 'dsp',
    pins: [aIn('in', 'Input'), aOut('out', 'Output')],
    params: [
      hz('lsFreq', 'LS Freq', 20, 500, 120),
      db('lsGain', 'LS Gain', -15, 15, 0),
      hz('b1Freq', 'B1 Freq', 80, 5000, 500),
      db('b1Gain', 'B1 Gain', -15, 15, 0),
      {
        id: 'b1Q',
        label: 'B1 Q',
        unit: '',
        min: 0.2,
        max: 12,
        step: 0.1,
        default: 1,
        taper: 'log',
      },
      hz('b2Freq', 'B2 Freq', 300, 12000, 2500),
      db('b2Gain', 'B2 Gain', -15, 15, 0),
      {
        id: 'b2Q',
        label: 'B2 Q',
        unit: '',
        min: 0.2,
        max: 12,
        step: 0.1,
        default: 1,
        taper: 'log',
      },
      hz('hsFreq', 'HS Freq', 2000, 20000, 8000),
      db('hsGain', 'HS Gain', -15, 15, 0),
    ],
    internalRouting: { in: ['out'] },
    createAudio: createPEQ,
  },

  compressor: {
    type: 'compressor',
    name: 'Compressor',
    category: 'dsp',
    pins: [aIn('in', 'Input'), aOut('out', 'Output')],
    params: [
      db('threshold', 'Threshold', -60, 0, -24),
      {
        id: 'ratio',
        label: 'Ratio',
        unit: '',
        min: 1,
        max: 20,
        step: 0.1,
        default: 4,
        taper: 'log',
      },
      {
        id: 'attack',
        label: 'Attack',
        unit: 'ms',
        min: 0.1,
        max: 200,
        step: 0.1,
        default: 10,
        taper: 'log',
      },
      {
        id: 'release',
        label: 'Release',
        unit: 'ms',
        min: 10,
        max: 1000,
        step: 1,
        default: 150,
        taper: 'log',
      },
      {
        id: 'knee',
        label: 'Knee',
        unit: 'dB',
        min: 0,
        max: 40,
        step: 1,
        default: 12,
      },
      db('makeup', 'Makeup', 0, 24, 0),
    ],
    internalRouting: { in: ['out'] },
    createAudio: createCompressor,
  },

  delay: {
    type: 'delay',
    name: 'Delay',
    category: 'dsp',
    pins: [aIn('in', 'Input'), cIn('mod', 'Mod'), aOut('out', 'Output')],
    params: [
      {
        id: 'time',
        label: 'Time',
        unit: 'ms',
        min: 1,
        max: 2000,
        step: 1,
        default: 250,
        taper: 'log',
      },
      pct('feedback', 'Feedback', 30),
      pct('mix', 'Mix', 30),
      pct('modAmt', 'Mod Amt', 0),
    ],
    internalRouting: { in: ['out'], mod: ['out'] },
    createAudio: createDelay,
  },

  reverb: {
    type: 'reverb',
    name: 'Reverb',
    category: 'dsp',
    pins: [aIn('in', 'Input'), aOut('out', 'Output')],
    params: [
      {
        id: 'decay',
        label: 'Decay',
        unit: 's',
        min: 0.1,
        max: 8,
        step: 0.1,
        default: 2,
        taper: 'log',
      },
      pct('mix', 'Mix', 30),
    ],
    internalRouting: { in: ['out'] },
    createAudio: createReverb,
  },

  distortion: {
    type: 'distortion',
    name: 'Distortion',
    category: 'dsp',
    pins: [aIn('in', 'Input'), aOut('out', 'Output')],
    params: [
      {
        id: 'drive',
        label: 'Drive',
        unit: '',
        min: 1,
        max: 50,
        step: 0.5,
        default: 4,
        taper: 'log',
      },
      pct('mix', 'Mix', 100),
      db('level', 'Level', -24, 6, -3),
    ],
    internalRouting: { in: ['out'] },
    createAudio: createDistortion,
  },

  panner: {
    type: 'panner',
    name: 'Panner',
    category: 'dsp',
    pins: [aIn('in', 'Input'), cIn('mod', 'Mod'), aOut('out', 'Output')],
    params: [
      {
        id: 'pan',
        label: 'Pan',
        unit: '%',
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      pct('modAmt', 'Mod Amt', 0),
    ],
    internalRouting: { in: ['out'], mod: ['out'] },
    createAudio: createPanner,
  },

  /* -------------------------------------------------------- routing */

  mixer: {
    type: 'mixer',
    name: 'Mixer 4×1',
    category: 'routing',
    pins: [
      aIn('in1', 'Input 1'),
      aIn('in2', 'Input 2'),
      aIn('in3', 'Input 3'),
      aIn('in4', 'Input 4'),
      aOut('out', 'Mix Out'),
    ],
    params: [
      db('lvl1', 'Level 1', -60, 12, 0),
      db('lvl2', 'Level 2', -60, 12, 0),
      db('lvl3', 'Level 3', -60, 12, 0),
      db('lvl4', 'Level 4', -60, 12, 0),
      db('master', 'Master', -60, 12, 0),
    ],
    internalRouting: {
      in1: ['out'],
      in2: ['out'],
      in3: ['out'],
      in4: ['out'],
    },
    createAudio: createMixer,
  },

  router: {
    type: 'router',
    name: 'Router 4×4',
    category: 'routing',
    pins: [
      aIn('in1', 'Input 1'),
      aIn('in2', 'Input 2'),
      aIn('in3', 'Input 3'),
      aIn('in4', 'Input 4'),
      aOut('out1', 'Output 1'),
      aOut('out2', 'Output 2'),
      aOut('out3', 'Output 3'),
      aOut('out4', 'Output 4'),
    ],
    params: [1, 2, 3, 4].flatMap((i) =>
      [1, 2, 3, 4].map((o) => toggle(`r${i}${o}`, `${i} → ${o}`, i === o ? 1 : 0)),
    ),
    // dynamic: the trace follows the ACTUAL crosspoint state
    internalRouting: (params) => {
      const map: Record<string, string[]> = {};
      for (let i = 1; i <= 4; i++) {
        map[`in${i}`] = [];
        for (let o = 1; o <= 4; o++) {
          if ((params[`r${i}${o}`] ?? (i === o ? 1 : 0)) > 0.5)
            map[`in${i}`].push(`out${o}`);
        }
      }
      return map;
    },
    createAudio: createRouter,
  },

  /* ------------------------------------------------------- metering */

  analyzer: {
    type: 'analyzer',
    name: 'Analyzer',
    category: 'meter',
    pins: [aIn('in', 'Input'), aOut('out', 'Thru')],
    params: [select('mode', 'Display', ['Waveform', 'Spectrum'])],
    internalRouting: { in: ['out'] },
    display: 'scope',
    createAudio: createAnalyzer,
  },

  /* --------------------------------------------------------- output */

  master_out: {
    type: 'master_out',
    name: 'Master Output',
    category: 'output',
    pins: [aIn('in', 'Input')],
    params: [db('level', 'Level', -60, 0, -6)],
    internalRouting: { in: [] },
    createAudio: createMasterOut,
  },
};

export const paletteOrder: Array<{
  category: ComponentSpec['category'];
  label: string;
  types: string[];
}> = [
  {
    category: 'source',
    label: 'Sources',
    types: ['signal_gen', 'noise_gen', 'media_player', 'mic_in'],
  },
  { category: 'mod', label: 'Modulation', types: ['lfo'] },
  {
    category: 'dsp',
    label: 'DSP',
    types: [
      'gain',
      'filter',
      'peq4',
      'compressor',
      'delay',
      'reverb',
      'distortion',
      'panner',
    ],
  },
  { category: 'routing', label: 'Routing', types: ['mixer', 'router'] },
  { category: 'meter', label: 'Metering', types: ['analyzer'] },
  { category: 'output', label: 'Outputs', types: ['master_out'] },
];

/** legacy type aliases from Build 1 designs */
export const typeAliases: Record<string, string> = {
  sine_gen: 'signal_gen',
};

/** resolve a component's internal routing for a given node's params */
export function resolveRouting(
  spec: ComponentSpec,
  params: Record<string, number>,
): Record<string, string[]> {
  return typeof spec.internalRouting === 'function'
    ? spec.internalRouting(params)
    : spec.internalRouting;
}
