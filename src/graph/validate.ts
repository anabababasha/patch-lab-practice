import { Design, PinRef } from '../lib/types';
import { registry, resolveRouting } from '../components/registry';

export interface Issue {
  id: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  nodeId?: string;
  pin?: PinRef;
}

export function validateDesign(design: Design): Issue[] {
  const issues: Issue[] = [];
  const { nodes, wires } = design;

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
          issues.push({
            id: `unconnected-in-${key}`,
            severity: 'warn',
            message: `Input '${pin.label}' of ${node.label} is unconnected.`,
            nodeId: node.id,
            pin: { nodeId: node.id, pinId: pin.id },
          });
        }
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
  }

  return issues;
}
