import type { ComponentSpec } from '../lib/types';
import {
  createGain,
  createMasterOut,
  createNoiseGen,
  createSineGen,
} from '../audio/units';

export const registry: Record<string, ComponentSpec> = {
  sine_gen: {
    type: 'sine_gen',
    name: 'Sine Generator',
    category: 'source',
    pins: [{ id: 'out', label: 'Output', direction: 'out', kind: 'audio' }],
    params: [
      {
        id: 'freq',
        label: 'Frequency',
        unit: 'Hz',
        min: 20,
        max: 20000,
        step: 1,
        default: 440,
        taper: 'log',
      },
      {
        id: 'level',
        label: 'Level',
        unit: 'dB',
        min: -60,
        max: 0,
        step: 0.5,
        default: -20,
      },
    ],
    internalRouting: {},
    createAudio: createSineGen,
  },

  noise_gen: {
    type: 'noise_gen',
    name: 'Pink Noise',
    category: 'source',
    pins: [{ id: 'out', label: 'Output', direction: 'out', kind: 'audio' }],
    params: [
      {
        id: 'level',
        label: 'Level',
        unit: 'dB',
        min: -60,
        max: 0,
        step: 0.5,
        default: -20,
      },
    ],
    internalRouting: {},
    createAudio: createNoiseGen,
  },

  gain: {
    type: 'gain',
    name: 'Gain',
    category: 'dsp',
    pins: [
      { id: 'in', label: 'Input', direction: 'in', kind: 'audio' },
      { id: 'out', label: 'Output', direction: 'out', kind: 'audio' },
    ],
    params: [
      {
        id: 'gain',
        label: 'Gain',
        unit: 'dB',
        min: -60,
        max: 12,
        step: 0.5,
        default: 0,
      },
      {
        id: 'mute',
        label: 'Mute',
        unit: '',
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        kind: 'toggle',
      },
    ],
    internalRouting: { in: ['out'] },
    createAudio: createGain,
  },

  master_out: {
    type: 'master_out',
    name: 'Master Output',
    category: 'output',
    pins: [{ id: 'in', label: 'Input', direction: 'in', kind: 'audio' }],
    params: [
      {
        id: 'level',
        label: 'Level',
        unit: 'dB',
        min: -60,
        max: 0,
        step: 0.5,
        default: -6,
      },
    ],
    internalRouting: { in: [] },
    createAudio: createMasterOut,
  },
};

export const paletteOrder: Array<{
  category: 'source' | 'dsp' | 'output';
  label: string;
  types: string[];
}> = [
  { category: 'source', label: 'Sources', types: ['sine_gen', 'noise_gen'] },
  { category: 'dsp', label: 'DSP', types: ['gain'] },
  { category: 'output', label: 'Outputs', types: ['master_out'] },
];
