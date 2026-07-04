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
];
