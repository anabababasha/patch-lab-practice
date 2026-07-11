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
  createMidiIn,
  createMicIn,
  createRecorder,
  createSampler,
  createMixer,
  createNoiseGen,
  createPanner,
  createPEQ,
  createReverb,
  createRouter,
  createSignalGen,
  createTriggerPad,
  createEnvelope,
  createStepSequencer,
  createLooper,
  createGrainDelay,
  createBufferRepeater,
} from '../audio/units';
import { DIVISIONS } from '../audio/sync';

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
const tIn = (id: string, label: string): PinSpec => ({
  id,
  label,
  direction: 'in',
  kind: 'trigger',
});
const tOut = (id: string, label: string): PinSpec => ({
  id,
  label,
  direction: 'out',
  kind: 'trigger',
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

const pan = (id: string, label: string): ParamSpec => ({
  id,
  label,
  unit: '',
  min: -1,
  max: 1,
  step: 0.01,
  default: 0,
  taper: 'lin',
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

const dropdown = (
  id: string,
  label: string,
  options: string[],
  def = 0,
): ParamSpec => ({
  ...select(id, label, options, def),
  selectStyle: 'dropdown',
});

/* ------------------------------------------------------------ registry */

export const registry: Record<string, ComponentSpec> = {
  /* ------------------------------------------------------- sources */

  trigger_pad: {
    type: 'trigger_pad',
    name: 'Trigger Pad',
    category: 'mod',
    pins: [tOut('out', 'Trig Out')],
    params: [],
    internalRouting: {},
    display: 'trigger',
    help: {
      summary: 'Manual trigger pad — fires every connected Envelope once per tap.',
      tips: [
        "Wire Trig Out to an Envelope's Trig input.",
        "Tap rhythmically to play a beat by hand."
      ],
      flows: [
        { title: 'Fire an envelope', chain: [{label:'Trigger Pad'}, {label:'Envelope', kind:'trigger'}, {label:'any Mod input', kind:'control'}] }
      ],
    },
    createAudio: createTriggerPad,
  },

  envelope: {
    type: 'envelope',
    name: 'Envelope',
    category: 'mod',
    pins: [tIn('trig', 'Trig'), cOut('out', 'Env Out')],
    params: [
      { id: 'attack', label: 'Attack', unit: 'ms', min: 0.1, max: 500, step: 0.1, default: 1, taper: 'log' },
      { id: 'decay', label: 'Decay', unit: 'ms', min: 5, max: 4000, step: 1, default: 200, taper: 'log' },
      select('curve', 'Curve', ['Exp', 'Lin'])
    ],
    internalRouting: { trig: ['out'] },
    help: {
      summary: 'One-shot attack/decay envelope. Fire it from a Trigger Pad; its dashed Env Out drives any Mod input.',
      tips: [
        "Env → Gain Mod (with Gain set low) makes a VCA — the core of a drum sound.",
        "Env → Signal Generator's Pitch input makes a pitch-drop, like a kick."
      ],
      flows: [
        { title: 'Drum hit (VCA)', chain: [{label:'Trigger Pad'}, {label:'Envelope', kind:'trigger'}, {label:'Gain · Mod', kind:'control'}] },
        { title: 'Kick pitch drop', chain: [{label:'Trigger Pad'}, {label:'Envelope', kind:'trigger'}, {label:'Signal Gen · Pitch', kind:'control'}] }
      ],
    },
    createAudio: createEnvelope,
  },

  signal_gen: {
    type: 'signal_gen',
    name: 'Signal Generator',
    category: 'source',
    pins: [cIn('pitch', 'Pitch'), aOut('out', 'Output')],
    params: [
      select('wave', 'Waveform', ['Sine', 'Square', 'Saw', 'Triangle']),
      hz('freq', 'Frequency', 20, 20000, 440),
      db('level', 'Level', -60, 0, -20),
      { id: 'pitchAmt', label: 'Pitch Mod', unit: '', min: -4800, max: 4800, step: 10, default: 2400 }
    ],
    internalRouting: { pitch: ['out'] },
    help: {
      summary: 'Test-signal oscillator. In real systems you\'d use a generator like this to verify a signal path before the source arrives.',
      tips: [
        'Sine at −20 dB is a safe alignment tone.',
        'Square/saw are harmonically rich — good for hearing filters work.',
        'Pitch input + an Envelope = a pitch-drop kick, snare pop, or laser sound.'
      ],
      flows: [
        { title: 'Basic test chain', chain: [{label:'Signal Gen'}, {label:'Gain', kind:'audio'}, {label:'Master Out', kind:'audio'}] }
      ],
    },
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
    help: {
      summary: 'Pink or white noise source. Pink noise has equal energy per octave — the standard for tuning rooms and speakers.',
      tips: ['Use pink noise + Filter to hear crossover-style slopes.', 'White noise sounds brighter because it has more high-frequency energy.'],
    },
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
    help: {
      summary: 'Plays an audio file you load from disk. Files are decoded in memory and do not survive a page reload.',
      tips: ['Loop a music track to test your full chain.', 'Level defaults to −6 dB — headroom before the master.'],
    },
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
    help: {
      summary: 'Live microphone input via the browser, with echo cancellation and auto-gain OFF for honest measurement.',
      tips: ['First Enable asks the browser for permission.', 'Watch for feedback: mute your speakers or use headphones.'],
    },
    display: 'mic',
    createAudio: createMicIn,
  },

  sampler: {
    type: 'sampler',
    name: 'Sampler',
    category: 'source',
    pins: [tIn('trig', 'Trig'), cIn('pitch', 'Pitch'), aOut('out', 'Output')],
    params: [
      db('level', 'Level', -60, 12, -6),
      { id: 'tune', label: 'Tune', unit: '', min: -24, max: 24, step: 1, default: 0 },
      { id: 'pitchAmt', label: 'Pitch Mod', unit: '', min: -4800, max: 4800, step: 10, default: 2400 },
      toggle('muted', 'Mute', 0),
      toggle('choke', 'Choke', 1),
    ],
    internalRouting: { trig: ['out'], pitch: ['out'] },
    help: {
      summary: 'Plays a loaded recording once per trigger — the sequencer\'s voice for REAL sounds.',
      tips: [
        'Load a real doum or tak recording and sequence it from the Step Sequencer.',
        'Tune shifts in semitones; Pitch Mod lets an Envelope or MIDI bend each hit.',
        'Choke off = overlapping tails (cymbals); on = tight drums.',
        'Mute silences ringing voices and ignores triggers until switched back on.',
        'Choke is per-sampler: two Samplers never choke each other.',
      ],
      flows: [
        { title: 'Sampled drum', chain: [{label:'Step Seq · Row 1'}, {label:'Sampler', kind:'trigger'}, {label:'Mixer / Master', kind:'audio'}] },
      ],
    },
    display: 'media',
    createAudio: createSampler,
  },

  midi_in: {
    type: 'midi_in',
    name: 'MIDI In',
    category: 'source',
    pins: [
      tOut('gate', 'Gate'),
      cOut('pitch', 'Pitch'),
      cOut('velocity', 'Velocity'),
    ],
    params: [
      {
        id: 'device',
        label: 'Device',
        unit: '',
        min: 0,
        max: 64,
        step: 1,
        default: 0,
        kind: 'select',
        options: ['All'],
        dynamicOptions: 'midiInputs',
        selectStyle: 'dropdown',
      },
      dropdown('channel', 'Channel', ['Omni', ...Array.from({ length: 16 }, (_, i) => `${i + 1}`)]),
      { id: 'octave', label: 'Octave', unit: '', min: -2, max: 2, step: 1, default: 0 },
      { id: 'computer', label: 'Computer keys', unit: '', min: 0, max: 1, step: 1, default: 0, kind: 'toggle', hidden: true },
    ],
    internalRouting: {},
    help: {
      summary: 'Play notes from a MIDI keyboard, your computer keys, or the clickable on-node keyboard - Pitch and Velocity as control signals, Gate as a trigger.',
      tips: [
        'Gate -> Envelope Trig, Pitch -> Signal Generator or Sampler Pitch: a playable voice.',
        'No MIDI hardware? The A-K row is a piano; toggle Computer keys.',
        'Safari/iOS have no Web MIDI - computer keys are the instrument there.',
      ],
      flows: [
        { title: 'Playable synth', chain: [{label:'MIDI In'}, {label:'Envelope Trig', kind:'trigger'}, {label:'Gain Mod', kind:'control'}] },
        { title: 'Note tracking', chain: [{label:'MIDI In Pitch'}, {label:'Signal Gen Pitch', kind:'control'}] },
      ],
    },
    display: 'midi',
    createAudio: createMidiIn,
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
        sync: { kind: 'hz', defaultDiv: 4 /* 1/4 */ },
      },
      { id: 'rate_div', label: 'Rate sync', unit: '', min: 0, max: 1 + DIVISIONS.length, step: 1, default: 0, hidden: true },
      pct('depth', 'Depth', 50),
    ],
    internalRouting: {},
    help: {
      summary: 'Low-frequency oscillator — a control signal, not audio. Wire its dashed Mod Out into a Mod input to animate a parameter.',
      tips: ['LFO → Gain Mod = tremolo.', 'LFO → Filter Mod = auto-wah.', 'LFO → Delay Mod = chorus/vibrato.', 'One LFO can fan out to several Mod inputs.', 'Sync locks Rate to the tempo — Free ignores it; Auto follows the session Sync switch.'],
      flows: [
        { title: 'Tremolo', chain: [{label:'LFO'}, {label:'Gain · Mod', kind:'control'}] },
        { title: 'Auto-wah', chain: [{label:'LFO'}, {label:'Filter · Mod', kind:'control'}] }
      ],
    },
    createAudio: createLFO,
  },

  step_seq: {
    type: 'step_seq',
    name: 'Step Sequencer',
    category: 'mod',
    display: 'sequencer',
    pins: [
      tOut('row1', 'Row 1 · Doum'),
      tOut('row2', 'Row 2 · Tak'),
      tOut('row3', 'Row 3 · Ka'),
      tOut('row4', 'Row 4 · Ghost'),
    ],
    params: [
      { id: 'steps', label: 'Steps', unit: '', min: 1, max: 16, step: 1, default: 16 },
      { id: 'rate', label: 'Rate', unit: '', min: 0, max: 1, step: 1, default: 0, kind: 'select', options: ['1/8', '1/16'] },
      toggle('muted', 'Mute'),
      ...Array.from({ length: 64 }, (_, i) => ({
        id: `s${Math.floor(i / 16) + 1}_${(i % 16) + 1}`,
        label: '',
        unit: '' as const,
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        kind: 'toggle' as const,
        hidden: true,
      })),
    ],
    internalRouting: {},
    help: {
      summary: "Pattern sequencer on the global transport. Four trigger rows — Doum, Tak, Ka, Ghost — fire envelopes in time. Presets load classic Arabic iqa'at.",
      tips: ["Row outs → Envelope Trigs → your drum voices.", "Mute stops new triggers while the playhead keeps sweeping; triggers already inside the lookahead window can still fire for about 100 ms.", "Set Steps to 10 and load Sama'i — odd meters are first-class here.", "Edit cells while it plays; changes land on the next pass."],
      flows: [{ title: 'Drum voice', chain: [{label:'Step Seq · Row 1'}, {label:'Envelope', kind:'trigger'}, {label:'Gain · Mod', kind:'control'}] }]
    },
    createAudio: createStepSequencer,
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
    help: {
      summary: 'Level control with mute. Its Mod input adds the incoming control signal to the gain — the building block of tremolo and VCA-style envelopes.',
      tips: ['Mod Amt scales how strongly modulation moves the level — 0 % means no effect.', 'Set Gain very low and let an Envelope push it up: that\'s a VCA.'],
      flows: [
        { title: 'VCA (envelope volume)', chain: [{label:'Envelope'}, {label:'Gain · Mod', kind:'control'}] }
      ],
    },
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
    help: {
      summary: 'Single biquad filter: low-pass, high-pass, band-pass, or notch. Mod input sweeps the cutoff (±2 octaves at 100 %).',
      tips: [
        'High Q + band-pass ≈ resonant sweep.',
        'Notch is what you\'d reach for to kill a feedback frequency.',
        "The curve shows the filter's base shape; Mod sweeps move the sound (watch the spectrum) around it.",
      ],
    },
    display: 'eq',
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
    help: {
      summary: '4-band parametric EQ: low shelf, two peaking bands, high shelf — the workhorse of system tuning.',
      tips: [
        'Cut before you boost.',
        'Narrow Q for surgical cuts, wide Q for tone shaping.',
        'Drag the dots on the curve - x is frequency, y is gain; scroll on a mid dot to narrow or widen it.',
      ],
    },
    display: 'eq',
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
    help: {
      summary: 'Dynamics control: reduces level above the threshold by the ratio. Makeup gain restores loudness.',
      tips: ['Start: threshold −24 dB, ratio 4:1, attack 10 ms, release 150 ms.', 'Extreme ratio + fast attack = limiter behavior.'],
    },
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
        sync: { kind: 'ms', defaultDiv: 6 /* 1/8 */ },
      },
      { id: 'time_div', label: 'Time sync', unit: '', min: 0, max: 1 + DIVISIONS.length, step: 1, default: 0, hidden: true },
      pct('feedback', 'Feedback', 30),
      pct('mix', 'Mix', 30),
      pct('modAmt', 'Mod Amt', 0),
    ],
    internalRouting: { in: ['out'], mod: ['out'] },
    help: {
      summary: 'Echo with feedback and wet/dry mix. Its Mod input wobbles the delay time — small amounts give chorus and vibrato.',
      tips: ['Feedback above 70 % builds up fast — watch the meters.', '1–20 ms + modulation = chorus', '100 ms+ = distinct echoes.', 'Sync locks Time to the tempo — Free ignores it; Auto follows the session Sync switch.'],
    },
    createAudio: createDelay,
  },

  grain_delay: {
    type: 'grain_delay',
    name: 'Grain Delay',
    category: 'dsp',
    pins: [aIn('in', 'Input'), aOut('out', 'Output')],
    params: [
      {
        id: 'time',
        label: 'Time',
        unit: 'ms',
        min: 10,
        max: 2000,
        step: 1,
        default: 250,
        taper: 'log',
        sync: { kind: 'ms', defaultDiv: 6 /* 1/8 */ },
      },
      { id: 'time_div', label: 'Time sync', unit: '', min: 0, max: 1 + DIVISIONS.length, step: 1, default: 0, hidden: true },
      { id: 'size', label: 'Grain Size', unit: 'ms', min: 20, max: 1000, step: 1, default: 100, taper: 'log' },
      { id: 'density', label: 'Density', unit: 'x', min: 0.25, max: 8, step: 0.25, default: 2 },
      { id: 'pitch', label: 'Pitch', unit: 'st', min: -24, max: 24, step: 1, default: 0 },
      { id: 'rndPitch', label: 'Rnd Pitch', unit: 'ct', min: 0, max: 100, step: 1, default: 0 },
      { id: 'spray', label: 'Spray', unit: 'ms', min: 0, max: 500, step: 1, default: 20 },
      pct('spread', 'Spread', 50),
      pct('feedback', 'Feedback', 35),
      pct('mix', 'Mix', 35),
      toggle('freeze', 'Freeze', 0),
      toggle('bypass', 'Bypass', 0),
    ],
    internalRouting: { in: ['out'] },
    help: {
      summary: 'Granular delay — clouds, freeze, pitch-sprayed echoes.',
      tips: [
        'Freeze stops recording and loops the last seconds — grains keep playing forever.',
        'A structural edit to this node\'s own wires rebuilds it and clears its ring — by design; unrelated edits never touch it.'
      ],
    },
    createAudio: createGrainDelay,
  },

  buffer_repeater: {
    type: 'buffer_repeater',
    name: 'Buffer Repeater',
    category: 'dsp',
    pins: [aIn('in', 'Input'), tIn('trig', 'Repeat'), aOut('out', 'Output')],
    params: [
      {
        id: 'interval',
        label: 'Interval',
        unit: '',
        min: 0,
        max: 4,
        step: 1,
        default: 2,
        kind: 'select',
        options: ['1/4', '1/2', '1 bar', '2 bars', '4 bars'],
      },
      { id: 'offset', label: 'Offset', unit: '', min: 0, max: 15, step: 1, default: 0 },
      pct('chance', 'Chance', 0),
      {
        id: 'grid',
        label: 'Grid',
        unit: '',
        min: 0,
        max: 6,
        step: 1,
        default: 2,
        kind: 'select',
        options: ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4', '1/2'],
      },
      { id: 'variation', label: 'Variation', unit: '', min: 0, max: 10, step: 1, default: 0 },
      { id: 'gate', label: 'Gate', unit: '', min: 1, max: 16, step: 1, default: 4 },
      { id: 'pitch', label: 'Pitch', unit: 'st', min: -12, max: 0, step: 1, default: 0 },
      pct('pitchDecay', 'Pitch Decay', 0),
      pct('decay', 'Decay', 0),
      {
        id: 'mode',
        label: 'Mode',
        unit: '',
        min: 0,
        max: 2,
        step: 1,
        default: 1,
        kind: 'select',
        options: ['Mix', 'Insert', 'Gate'],
      },
      toggle('bypass', 'Bypass', 0),
    ],
    internalRouting: { in: ['out'] },
    help: {
      summary: 'Ableton-style tempo-locked stutter/glitch.',
      tips: [
        'Chance is 0 by default — wire a trigger or raise Chance to ignite it.',
        'Gate shorter than Grid is silent by design.',
        'Repeats pitch DOWN by slowing playback — each repeat covers less of the slice (the classic blur).',
        'Long holds auto-release after about 5 seconds before the live input can lap the slice.'
      ],
    },
    createAudio: createBufferRepeater,
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
    help: {
      summary: 'Convolution reverb with a synthesized impulse response. Decay sets the tail length.',
      tips: ['Keep Mix below 50 % for realism.', 'Long decay + high mix = washed-out; use an EQ after to tame lows.'],
    },
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
    help: {
      summary: 'Waveshaping saturation. Drive pushes the signal into a tanh curve — from warm to aggressive.',
      tips: ['Lower the output Level as you raise Drive.', 'Try Filter AFTER distortion to sculpt the harmonics it adds.'],
    },
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
    help: {
      summary: 'Stereo position. Mod input auto-pans (±100 % at full amount).',
      tips: ['Slow LFO → Panner Mod = classic auto-pan.', 'Hard-panned generators are useful for checking L/R wiring.'],
    },
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
      pan('pan1', 'Pan 1'),
      toggle('mute1', 'Mute 1'),
      toggle('solo1', 'Solo 1'),
      db('lvl2', 'Level 2', -60, 12, 0),
      pan('pan2', 'Pan 2'),
      toggle('mute2', 'Mute 2'),
      toggle('solo2', 'Solo 2'),
      db('lvl3', 'Level 3', -60, 12, 0),
      pan('pan3', 'Pan 3'),
      toggle('mute3', 'Mute 3'),
      toggle('solo3', 'Solo 3'),
      db('lvl4', 'Level 4', -60, 12, 0),
      pan('pan4', 'Pan 4'),
      toggle('mute4', 'Mute 4'),
      toggle('solo4', 'Solo 4'),
      db('master', 'Master', -60, 12, 0),
    ],
    internalRouting: {
      in1: ['out'],
      in2: ['out'],
      in3: ['out'],
      in4: ['out'],
    },
    help: {
      summary: 'Each input has Level + Pan — a four-channel console into one stereo Mix Out.',
      tips: [
        'Inputs sum: four hot signals can overload — trim each.',
        'Pan each input before the stereo Mix Out to place sources left, center, or right.',
        'This is the ONLY way to merge signals; inputs accept one wire each.',
        'Solo isolates one or more inputs; Mute always wins over Solo.',
      ],
      flows: [
        { title: 'Sum two chains', chain: [{label:'Source A / Source B'}, {label:'Mixer', kind:'audio'}, {label:'Master Out', kind:'audio'}] }
      ],
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
    help: {
      summary: '4×4 crosspoint matrix. Toggle any input to any output — and the trace highlight follows the LIVE routing state.',
      tips: ['Pin a trace on an input, then flip crosspoints and watch the path move.', 'An input routed to nothing is silent — the Check tab flags it.'],
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
    help: {
      summary: 'Pass-through scope: waveform or log-frequency spectrum, drawn live in the node.',
      tips: ['Waveform shows shape and clipping; Spectrum shows tonal balance.', 'Put one before AND after a processor to see what it does.'],
    },
    display: 'scope',
    createAudio: createAnalyzer,
  },

  looper: {
    type: 'looper',
    name: 'Looper',
    category: 'dsp',
    pins: [aIn('in', 'Input'), aOut('out', 'Output')],
    params: [
      db('loopLevel', 'Loop', -60, 6, 0),
      { ...db('thruLevel', 'Thru', -60, 6, 0), hidden: true },
      toggle('sync', 'Bar sync', 1),
      toggle('playSync', 'Play sync', 0),
      select('speed', 'Speed', ['\u00bd\u00d7', '1\u00d7', '2\u00d7'], 1),
    ],
    internalRouting: { in: [] },
    help: {
      summary: 'Captures what flows through it and plays back the loop. Output is the loop only - patch your dry signal in parallel.',
      tips: [
        "Play sync quantizes PLAY to the next bar and locks the loop's phase to the transport grid - all synced loops land together. Off = free-running (start anywhere, drift free).",
        'Bar sync locks loops to the transport — record a 2-bar phrase over the drum machine and it lands on the grid.',
        'Output is silent while empty or stopped; fan out the dry source if you want live monitoring.',
        'Loop several sources at once: sum them with a Mixer first — Mix Out → Input.',
        'Drag the edges of the waveform to trim the loop - edges snap to zero-crossings so it never clicks.',
        'Normalize, Reverse, trim, and Speed update the playing loop through the loop-only output path.',
        '\u00bd\u00d7 is an octave down, tape-style.',
      ],
      flows: [
        {
          title: 'Live layering',
          chain: [{ label: 'Sampler / Synth' }, { label: 'Looper loop', kind: 'audio' }, { label: 'Master Out', kind: 'audio' }],
        },
      ],
    },
    display: 'looper',
    createAudio: createLooper,
  },

  /* --------------------------------------------------------- output */

  recorder: {
    type: 'recorder',
    name: 'Recorder',
    category: 'output',
    pins: [aIn('in', 'Input'), aOut('out', 'Thru')],
    params: [select('format', 'Format', ['WAV', 'WebM'], 0)],
    internalRouting: { in: ['out'] },
    help: {
      summary: 'Records everything flowing through it to an audio file — press REC, perform, press STOP, the file downloads.',
      tips: [
        'WAV opens everywhere; WebM is far smaller for long takes.',
        'Place it between your final Mixer and the Master Output to capture the whole performance.',
        'Recording survives edits — patch live while the take rolls.',
      ],
      flows: [
        { title: 'Capture a set', chain: [{label:'Mixer'}, {label:'Recorder', kind:'audio'}, {label:'Master Out', kind:'audio'}] },
      ],
    },
    display: 'recorder',
    createAudio: createRecorder,
  },

  master_out: {
    type: 'master_out',
    name: 'Master Output',
    category: 'output',
    pins: [aIn('in', 'Input')],
    params: [db('level', 'Level', -60, 0, -6), toggle('muted', 'Mute')],
    internalRouting: { in: [] },
    help: {
      summary: 'The speakers. Includes a permanent safety limiter at −1 dBFS and a click-free final mute; the meter stays live before the limiter and mute.',
      tips: ['Red clip segment = your mix is over; turn sources down, not just this fader.', 'Mute silences this Master only while the meter keeps showing what will return.', 'Multiple Master Outputs are allowed but usually a mistake.'],
    },
    display: 'master',
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
    types: ['signal_gen', 'noise_gen', 'media_player', 'mic_in', 'sampler', 'midi_in'],
  },
  { category: 'mod', label: 'Modulation', types: ['lfo', 'envelope', 'trigger_pad', 'step_seq'] },
  {
    category: 'dsp',
    label: 'DSP',
    types: [
      'gain',
      'filter',
      'peq4',
      'compressor',
      'delay',
      'grain_delay',
      'buffer_repeater',
      'reverb',
      'distortion',
      'panner',
      'looper',
    ],
  },
  { category: 'routing', label: 'Routing', types: ['mixer', 'router'] },
  { category: 'meter', label: 'Metering', types: ['analyzer'] },
  { category: 'output', label: 'Outputs', types: ['recorder', 'master_out'] },
];

/** legacy type aliases from Build 1 designs */
export const typeAliases: Record<string, string> = {
  sine_gen: 'signal_gen',
  beat_repeat: 'buffer_repeater', // pre-release rename (brand-name collision)
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
