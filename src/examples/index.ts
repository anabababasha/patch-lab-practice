import { Design, NodeInstance, Wire } from '../lib/types';
import { registry } from '../components/registry';

const uid = (prefix: string) => `${prefix}_ex_${Math.random().toString(36).slice(2, 9)}`;

function buildExample(cb: (n: (type: string, x: number, y: number, params?: Record<string, number>) => string, w: (fromNode: string, fromPin: string, toNode: string, toPin: string) => void) => void): Design {
  const nodes: NodeInstance[] = [];
  const wires: Wire[] = [];

  const n = (type: string, x: number, y: number, params: Record<string, number> = {}): string => {
    const spec = registry[type];
    const node: NodeInstance = { id: uid('n'), type, label: spec.name, x, y, params: { ...params } };
    for (const p of spec.params) {
      if (!(p.id in node.params)) {
        node.params[p.id] = p.default;
      }
    }
    nodes.push(node);
    return node.id;
  };

  const w = (fromNode: string, fromPin: string, toNode: string, toPin: string) => {
    const fromType = nodes.find(x => x.id === fromNode)?.type;
    const kind = fromType ? registry[fromType]?.pins.find(p => p.id === fromPin)?.kind || 'audio' : 'audio';
    wires.push({
      id: uid('w'),
      from: { nodeId: fromNode, pinId: fromPin },
      to: { nodeId: toNode, pinId: toPin },
      colorIndex: (wires.length % 4) + 1,
      kind,
    });
  };

  cb(n, w);
  return { version: 1, name: 'Example', nodes, wires };
}

export const examples = [
  {
    id: 'kick',
    name: 'Kick Drum',
    blurb: 'Tap TRIG. Pitch drop + volume snap = kick.',
    build: () => buildExample((n, w) => {
      const sig = n('signal_gen', 0, 0, { freq: 50, level: -6, pitchAmt: 2400 });
      const envA = n('envelope', 0, 140, { attack: 1, decay: 60 });
      const pad = n('trigger_pad', 0, 280);
      const envB = n('envelope', 260, 280, { attack: 0.5, decay: 250 });
      const gain = n('gain', 260, 0, { gain: -60, modAmt: 100 });
      const master = n('master_out', 520, 0, { master: -6 });

      w(sig, 'out', gain, 'in');
      w(gain, 'out', master, 'in');
      w(envA, 'out', sig, 'pitch');
      w(envB, 'out', gain, 'mod');
      w(pad, 'out', envA, 'trig');
      w(pad, 'out', envB, 'trig');
    }),
  },
  {
    id: 'tremolo',
    name: 'Tremolo',
    blurb: 'An LFO wobbling a volume knob.',
    build: () => buildExample((n, w) => {
      const sig = n('signal_gen', 0, 0, { freq: 440, level: -14 });
      const gain = n('gain', 260, 0, { gain: 0, modAmt: 60 });
      const master = n('master_out', 520, 0);
      const lfo = n('lfo', 260, 140, { rate: 5, depth: 80 });

      w(sig, 'out', gain, 'in');
      w(gain, 'out', master, 'in');
      w(lfo, 'out', gain, 'mod');
    }),
  },
  {
    id: 'autowah',
    name: 'Auto-Wah',
    blurb: 'Slow LFO sweeping a resonant band-pass.',
    build: () => buildExample((n, w) => {
      const noise = n('noise_gen', 0, 0, { type: 0, level: -14 }); // 0 = Pink
      const filter = n('filter', 260, 0, { type: 2, freq: 800, q: 6, modAmt: 70 }); // 2 = Band-pass
      const master = n('master_out', 520, 0);
      const lfo = n('lfo', 260, 140, { rate: 0.4, depth: 90 });

      w(noise, 'out', filter, 'in');
      w(filter, 'out', master, 'in');
      w(lfo, 'out', filter, 'mod');
    }),
  },
  {
    id: 'dubdelay',
    name: 'Dub Delay',
    blurb: 'High feedback = echoes that regenerate. Watch them decay on the scope.',
    build: () => buildExample((n, w) => {
      const sig = n('signal_gen', 0, 0, { freq: 330, level: -16 });
      const delay = n('delay', 260, 0, { time: 380, feedback: 65, mix: 55 });
      const analyzer = n('analyzer', 520, 0);
      const master = n('master_out', 780, 0);

      w(sig, 'out', delay, 'in');
      w(delay, 'out', analyzer, 'in');
      w(analyzer, 'out', master, 'in');
    }),
  },
  {
    id: 'scope',
    name: 'Scope Demo',
    blurb: 'Change the waveform and watch the shape; switch the Analyzer to Spectrum.',
    build: () => buildExample((n, w) => {
      const sig = n('signal_gen', 0, 0, { freq: 110, level: -12 });
      const analyzer = n('analyzer', 260, 0);
      const master = n('master_out', 520, 0);

      w(sig, 'out', analyzer, 'in');
      w(analyzer, 'out', master, 'in');
    }),
  },
  {
    id: 'drum_machine_maqsum',
    name: 'Drum Machine (Maqsum)',
    blurb: "Press Play. That's Maqsum — doum on the sine, tak on the noise.",
    build: () => buildExample((n, w) => {
      const p: Record<string, number> = { steps: 8, rate: 0 }; // 0 = 1/8
      [1,0,0,0,1,0,0,0].forEach((v, c) => p[`s1_${c+1}`] = v);
      [0,1,0,1,0,0,1,0].forEach((v, c) => p[`s2_${c+1}`] = v);

      const seq = n('step_seq', 0, 0, p);
      
      const envA = n('envelope', 340, 0, { attack: 1, decay: 60 });
      const envB = n('envelope', 340, 140, { attack: 0.5, decay: 200 });
      const sigA = n('signal_gen', 600, 0, { wave: 0, freq: 50, level: -6, pitchAmt: 2400 });
      const gainA = n('gain', 860, 0, { gain: -60, modAmt: 100 });
      
      const envC = n('envelope', 340, 280, { attack: 0.3, decay: 90 });
      const noise = n('noise_gen', 600, 280, { type: 1, level: -10 }); // 1 = White
      const filter = n('filter', 600, 420, { type: 1, freq: 2500, q: 1.5 }); // 1 = High-pass
      const gainB = n('gain', 860, 280, { gain: -60, modAmt: 100 });
      
      const mixer = n('mixer', 1120, 0);
      const master = n('master_out', 1380, 0);

      // Doum (Row 1)
      w(seq, 'row1', envA, 'trig');
      w(seq, 'row1', envB, 'trig');
      w(envA, 'out', sigA, 'pitch');
      w(sigA, 'out', gainA, 'in');
      w(envB, 'out', gainA, 'mod');
      
      // Tak (Row 2)
      w(seq, 'row2', envC, 'trig');
      w(noise, 'out', filter, 'in');
      w(filter, 'out', gainB, 'in');
      w(envC, 'out', gainB, 'mod');
      
      // Mix
      w(gainA, 'out', mixer, 'in1');
      w(gainB, 'out', mixer, 'in2');
      w(mixer, 'out', master, 'in');
    }),
  },
  {
    id: 'sampler_kit_maqsum',
    name: 'Sampler Kit (Maqsum)',
    blurb: 'Load a low hit into Sampler A and a sharp one into B, press Play — Maqsum with your own sounds.',
    build: () => buildExample((n, w) => {
      const p: Record<string, number> = { steps: 8, rate: 0 }; // 0 = 1/8
      [1,0,0,0,1,0,0,0].forEach((v, c) => p[`s1_${c+1}`] = v);
      [0,1,0,1,0,0,1,0].forEach((v, c) => p[`s2_${c+1}`] = v);

      const seq = n('step_seq', 0, 0, p);
      const samplerA = n('sampler', 340, 0);
      const samplerB = n('sampler', 340, 140);
      const mixer = n('mixer', 600, 0);
      const master = n('master_out', 860, 0, { level: -6 });

      w(seq, 'row1', samplerA, 'trig');
      w(seq, 'row2', samplerB, 'trig');
      w(samplerA, 'out', mixer, 'in1');
      w(samplerB, 'out', mixer, 'in2');
      w(mixer, 'out', master, 'in');
    }),
  },
  {
    id: 'playable_synth',
    name: 'Playable Synth',
    blurb: "Press A-K on your keyboard. That's an instrument.",
    build: () => buildExample((n, w) => {
      const midi = n('midi_in', 0, 0);
      const env = n('envelope', 300, 0, { attack: 2, decay: 400 });
      const sig = n('signal_gen', 300, 150, { wave: 2, freq: 440, level: -8, pitchAmt: 2400 });
      const filter = n('filter', 600, 150, { type: 0, freq: 1800, q: 2 });
      const gain = n('gain', 900, 150, { gain: -60, modAmt: 100 });
      const master = n('master_out', 1200, 150, { level: -6 });

      w(midi, 'gate', env, 'trig');
      w(env, 'out', gain, 'mod');
      w(midi, 'pitch', sig, 'pitch');
      w(sig, 'out', filter, 'in');
      w(filter, 'out', gain, 'in');
      w(gain, 'out', master, 'in');
    }),
  },
];
