import { Design, PinRef } from '../lib/types';
import { registry, resolveRouting } from '../components/registry';

export interface Issue {
  id: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  nodeId?: string;
  pin?: PinRef;
}

export function validateDesign(design: Design, audioRunning = true): Issue[] {
  const issues: Issue[] = [];
  const { nodes, wires } = design;

  if (!audioRunning && wires.length > 0) {
    issues.push({
      id: 'audio-not-running',
      severity: 'info',
      message: 'Audio is not running — press Start Audio (or tap a Trigger Pad) to hear your design.',
    });
  }

  const hasMaster = nodes.some((n) => n.type === 'master_out');
  if (!hasMaster) {
    issues.push({
      id: 'no-master',
      severity: 'error',
      message: 'No Master Output — nothing reaches the speakers.',
    });
  }

  const inWires = new Map<string, string[]>(); // inPinKey -> outPinKeys
  const outWires = new Map<string, string[]>(); // outPinKey -> inPinKeys
  
  for (const w of wires) {
    const fromKey = `${w.from.nodeId}:${w.from.pinId}`;
    const toKey = `${w.to.nodeId}:${w.to.pinId}`;
    if (!outWires.has(fromKey)) outWires.set(fromKey, []);
    outWires.get(fromKey)!.push(toKey);
    if (!inWires.has(toKey)) inWires.set(toKey, []);
    inWires.get(toKey)!.push(fromKey);
  }

  for (const node of nodes) {
    const spec = registry[node.type];
    if (!spec) continue;

    // Rule 2: unconnected audio input on non-source node
    if (spec.category !== 'source') {
      const audioIns = spec.pins.filter((p) => p.direction === 'in' && p.kind === 'audio');
      for (const pin of audioIns) {
        const key = `${node.id}:${pin.id}`;
        if (!inWires.has(key) || inWires.get(key)!.length === 0) {
          const isMixerOrRouter = node.type === 'mixer' || node.type === 'router';
          issues.push({
            id: `unconnected-in-${key}`,
            severity: isMixerOrRouter ? 'info' : 'warn',
            message: `Input '${pin.label}' of ${node.label} is unconnected.`,
            nodeId: node.id,
            pin: { nodeId: node.id, pinId: pin.id },
          });
        }
      }
    }

    if (node.type === 'step_seq') {
      const hasAnyWire = ['row1', 'row2', 'row3', 'row4'].some(
        (pinId) => (outWires.get(`${node.id}:${pinId}`)?.length || 0) > 0
      );
      if (!hasAnyWire) {
        issues.push({
          id: `unsequenced-${node.id}`,
          severity: 'warn',
          message: `${node.label} is sequencing nothing — wire a Row out to an Envelope's Trig.`,
          nodeId: node.id,
        });
      }
    }

    // Rule 3: node (except master_out) whose audio outputs all have zero wires
    if (node.type !== 'master_out') {
      const audioOuts = spec.pins.filter((p) => p.direction === 'out' && p.kind === 'audio');
      if (audioOuts.length > 0) {
        let anyConnected = false;
        for (const pin of audioOuts) {
          const key = `${node.id}:${pin.id}`;
          if (outWires.has(key) && outWires.get(key)!.length > 0) {
            anyConnected = true;
            break;
          }
        }
        if (!anyConnected) {
          issues.push({
            id: `unconnected-out-${node.id}`,
            severity: 'warn',
            message: `${node.label} output goes nowhere.`,
            nodeId: node.id,
          });
        }
      }
    }

    // Rule 4: LFO with unconnected Mod Out
    if (node.type === 'lfo') {
      const modOutPin = spec.pins.find((p) => p.id === 'out');
      if (modOutPin) {
        const key = `${node.id}:out`;
        if (!outWires.has(key) || outWires.get(key)!.length === 0) {
          issues.push({
            id: `lfo-unconnected-${node.id}`,
            severity: 'warn',
            message: `${node.label} modulates nothing — wire Mod Out to a Mod input.`,
            nodeId: node.id,
            pin: { nodeId: node.id, pinId: 'out' },
          });
        }
      }
    }

    // Rule 5: Mod input HAS wire but modAmt is 0
    const modInPin = spec.pins.find((p) => p.direction === 'in' && p.kind === 'control' && p.id === 'mod');
    if (modInPin) {
      const key = `${node.id}:mod`;
      if (inWires.has(key) && inWires.get(key)!.length > 0) {
        const modAmt = node.params['modAmt'] ?? spec.params.find(p => p.id === 'modAmt')?.default ?? 0;
        if (modAmt === 0) {
          issues.push({
            id: `mod-amt-zero-${node.id}`,
            severity: 'info',
            message: `${node.label} receives modulation but Mod Amt is 0 % — raise it to hear the effect.`,
            nodeId: node.id,
            pin: { nodeId: node.id, pinId: 'mod' },
          });
        }
      }
    }

    // Rule 6: Router input wired but routed to zero outputs
    if (node.type === 'router') {
      const inPins = spec.pins.filter((p) => p.direction === 'in');
      const routing = resolveRouting(spec, node.params);
      for (const pin of inPins) {
        const key = `${node.id}:${pin.id}`;
        if (inWires.has(key) && inWires.get(key)!.length > 0) {
          const outPins = routing[pin.id] || [];
          if (outPins.length === 0) {
            const inputNum = pin.id.replace('in', '');
            issues.push({
              id: `router-unrouted-${key}`,
              severity: 'warn',
              message: `Router input ${inputNum} is connected but not routed to any output.`,
              nodeId: node.id,
              pin: { nodeId: node.id, pinId: pin.id },
            });
          }
        }
      }
    }

    // Rule 7: Envelope with unconnected trig input
    if (node.type === 'envelope') {
      const key = `${node.id}:trig`;
      if (!inWires.has(key) || inWires.get(key)!.length === 0) {
        issues.push({
          id: `env-unconnected-${node.id}`,
          severity: 'warn',
          message: `${node.label} will never fire — wire a Trigger Pad (or later, MIDI) to its Trig input.`,
          nodeId: node.id,
          pin: { nodeId: node.id, pinId: 'trig' },
        });
      }
    }

    if (node.type === 'sampler') {
      const key = `${node.id}:trig`;
      const hasTrig = inWires.has(key) && inWires.get(key)!.length > 0;
      if (!hasTrig) {
        issues.push({
          id: `sampler-unconnected-${node.id}`,
          severity: 'warn',
          message: `${node.label} will never fire — wire a Trigger Pad (or later, MIDI) to its Trig input.`,
          nodeId: node.id,
          pin: { nodeId: node.id, pinId: 'trig' },
        });
      } else if (!node.meta?.file) {
        issues.push({
          id: `sampler-nofile-${node.id}`,
          severity: 'warn',
          message: `${node.label} has no sample loaded — tap Load file on the node.`,
          nodeId: node.id,
        });
      }
    }

    if (node.type === 'recorder') {
      const key = `${node.id}:in`;
      if (!inWires.has(key) || inWires.get(key)!.length === 0) {
        issues.push({
          id: `recorder-unconnected-${node.id}`,
          severity: 'warn',
          message: `${node.label} hears nothing — wire your mix into it.`,
          nodeId: node.id,
          pin: { nodeId: node.id, pinId: 'in' },
        });
      }
    }

    if (node.type === 'looper') {
      const key = `${node.id}:in`;
      if (!inWires.has(key) || inWires.get(key)!.length === 0) {
        issues.push({
          id: `looper-unconnected-${node.id}`,
          severity: 'warn',
          message: `${node.label} hears nothing — wire your mix into it.`,
          nodeId: node.id,
          pin: { nodeId: node.id, pinId: 'in' },
        });
      }
    }

    // Rule 8: Node with trigger output but zero wires
    if (node.type !== 'step_seq') {
      const triggerOuts = spec.pins.filter((p) => p.direction === 'out' && p.kind === 'trigger');
      for (const pin of triggerOuts) {
        const key = `${node.id}:${pin.id}`;
        if (!outWires.has(key) || outWires.get(key)!.length === 0) {
          issues.push({
            id: `trigger-unconnected-${key}`,
            severity: 'warn',
            message: `${node.label} is not connected to anything — it won't do anything when tapped.`,
            nodeId: node.id,
            pin: { nodeId: node.id, pinId: pin.id },
          });
        }
      }
    }
  }

  return issues;
}
