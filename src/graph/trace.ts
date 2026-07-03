import type { Design, PinRef, Wire } from '../lib/types';
import { pinKey } from '../lib/types';
import { registry, resolveRouting } from '../components/registry';

export interface TraceResult {
  nodes: Set<string>;
  wires: Set<string>;
  pins: Set<string>; // pinKey()s
  hueIndex: number; // 1..4 -> the traced path renders in this signal hue
}

/**
 * The signature interaction: given any pin, light the FULL signal path —
 * downstream to every sink and upstream to every source — crossing both
 * wires and each component's internal in->out routing. O(V+E), synchronous.
 */
export function computeTrace(design: Design, start: PinRef): TraceResult {
  const nodeById = new Map(design.nodes.map((n) => [n.id, n]));

  const wiresFromOut = new Map<string, Wire[]>();
  const wireIntoIn = new Map<string, Wire>(); // fan-in is forbidden -> single
  for (const w of design.wires) {
    const k = pinKey(w.from);
    const arr = wiresFromOut.get(k);
    if (arr) arr.push(w);
    else wiresFromOut.set(k, [w]);
    wireIntoIn.set(pinKey(w.to), w);
  }

  const specOf = (nodeId: string) => {
    const n = nodeById.get(nodeId);
    return n ? registry[n.type] : undefined;
  };

  const dirOf = (r: PinRef): 'in' | 'out' | undefined =>
    specOf(r.nodeId)?.pins.find((p) => p.id === r.pinId)?.direction;

  const routingOf = (nodeId: string): Record<string, string[]> => {
    const n = nodeById.get(nodeId);
    const spec = specOf(nodeId);
    return n && spec ? resolveRouting(spec, n.params) : {};
  };

  // reverse internal routing per node: outPinId -> inPinIds
  const reverseRouting = (nodeId: string): Record<string, string[]> => {
    const rev: Record<string, string[]> = {};
    for (const [inId, outs] of Object.entries(routingOf(nodeId))) {
      for (const outId of outs) (rev[outId] ??= []).push(inId);
    }
    return rev;
  };

  const nodes = new Set<string>();
  const wires = new Set<string>();
  const pins = new Set<string>();
  let hueIndex = 0;

  const addWire = (w: Wire) => {
    wires.add(w.id);
    if (!hueIndex) hueIndex = w.colorIndex;
  };
  const addPin = (r: PinRef) => {
    pins.add(pinKey(r));
    nodes.add(r.nodeId);
  };

  // hue preference: the wire touching the start pin, if any
  const startDir = dirOf(start);
  if (startDir === 'out') {
    const w = wiresFromOut.get(pinKey(start))?.[0];
    if (w) hueIndex = w.colorIndex;
  } else if (startDir === 'in') {
    const w = wireIntoIn.get(pinKey(start));
    if (w) hueIndex = w.colorIndex;
  }

  const walk = (startPin: PinRef, downstream: boolean) => {
    const seen = new Set<string>();
    const stack: PinRef[] = [startPin];
    while (stack.length) {
      const p = stack.pop()!;
      const k = pinKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      const dir = dirOf(p);
      if (!dir) continue;
      addPin(p);

      if (downstream) {
        if (dir === 'out') {
          for (const w of wiresFromOut.get(k) ?? []) {
            addWire(w);
            stack.push(w.to);
          }
        } else {
          const outs = routingOf(p.nodeId)[p.pinId] ?? [];
          for (const outId of outs) stack.push({ nodeId: p.nodeId, pinId: outId });
        }
      } else {
        if (dir === 'in') {
          const w = wireIntoIn.get(k);
          if (w) {
            addWire(w);
            stack.push(w.from);
          }
        } else {
          const ins = reverseRouting(p.nodeId)[p.pinId] ?? [];
          for (const inId of ins) stack.push({ nodeId: p.nodeId, pinId: inId });
        }
      }
    }
  };

  walk(start, true);
  walk(start, false);
  nodes.add(start.nodeId);

  return { nodes, wires, pins, hueIndex: hueIndex || 1 };
}

/** Trace from a wire: identical to tracing from its source pin, hued by the wire. */
export function computeTraceFromWire(
  design: Design,
  wireId: string,
): TraceResult | null {
  const w = design.wires.find((x) => x.id === wireId);
  if (!w) return null;
  const t = computeTrace(design, w.from);
  t.hueIndex = w.colorIndex;
  return t;
}
