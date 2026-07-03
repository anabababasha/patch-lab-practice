import { create } from 'zustand';
import type { Design, NodeInstance, PinRef, Wire } from '../lib/types';
import { registry } from '../components/registry';
import { computeTrace, computeTraceFromWire } from '../graph/trace';
import type { TraceResult } from '../graph/trace';
import { engine } from '../audio/engine';

const STORAGE_KEY = 'patchlab.design.v1';
const HISTORY_MAX = 50;

const uid = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

const emptyDesign = (): Design => ({
  version: 1,
  name: 'Untitled system',
  nodes: [],
  wires: [],
});

/* ------------------------------------------------ persistence helpers */

let saveTimer: number | undefined;
function saveSoon(design: Design) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
    } catch {
      /* storage full / unavailable — autosave is best-effort */
    }
  }, 500);
}

/** Validate + sanitize an unknown parsed value into a Design, or null. */
export function sanitizeDesign(raw: unknown): Design | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<Design>;
  if (d.version !== 1 || !Array.isArray(d.nodes) || !Array.isArray(d.wires))
    return null;

  const nodes: NodeInstance[] = [];
  for (const n of d.nodes) {
    if (!n || typeof n !== 'object') continue;
    const spec = registry[(n as NodeInstance).type];
    if (!spec) continue; // unknown component type -> drop
    const src = n as NodeInstance;
    const params: Record<string, number> = {};
    for (const p of spec.params) {
      const v = src.params?.[p.id];
      params[p.id] =
        typeof v === 'number' && Number.isFinite(v)
          ? Math.min(p.max, Math.max(p.min, v))
          : p.default;
    }
    nodes.push({
      id: typeof src.id === 'string' ? src.id : uid('n'),
      type: spec.type,
      label: typeof src.label === 'string' ? src.label : spec.name,
      x: typeof src.x === 'number' ? src.x : 0,
      y: typeof src.y === 'number' ? src.y : 0,
      params,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const pinOk = (r: PinRef, dir: 'in' | 'out') => {
    if (!r || !nodeIds.has(r.nodeId)) return false;
    const node = nodes.find((n) => n.id === r.nodeId)!;
    return registry[node.type].pins.some(
      (p) => p.id === r.pinId && p.direction === dir,
    );
  };

  const wires: Wire[] = [];
  const takenInputs = new Set<string>();
  for (const w of d.wires) {
    if (!w || typeof w !== 'object') continue;
    const src = w as Wire;
    if (!pinOk(src.from, 'out') || !pinOk(src.to, 'in')) continue;
    const inKey = `${src.to.nodeId}:${src.to.pinId}`;
    if (takenInputs.has(inKey)) continue;
    takenInputs.add(inKey);
    wires.push({
      id: typeof src.id === 'string' ? src.id : uid('w'),
      from: { nodeId: src.from.nodeId, pinId: src.from.pinId },
      to: { nodeId: src.to.nodeId, pinId: src.to.pinId },
      colorIndex:
        typeof src.colorIndex === 'number' &&
        src.colorIndex >= 1 &&
        src.colorIndex <= 4
          ? src.colorIndex
          : (wires.length % 4) + 1,
    });
  }

  return {
    version: 1,
    name: typeof d.name === 'string' ? d.name : 'Untitled system',
    nodes,
    wires,
  };
}

function loadSaved(): Design | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeDesign(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- store */

interface UiState {
  selectedNodeId: string | null;
  selectedWireId: string | null;
  trace: TraceResult | null;
  tracePinned: boolean;
  toast: { id: number; msg: string } | null;
}

interface AppState {
  design: Design;
  ui: UiState;
  audioRunning: boolean;

  addNode(type: string, x: number, y: number): void;
  moveNode(id: string, x: number, y: number): void;
  removeNode(id: string): void;
  addWire(a: PinRef, b: PinRef): void;
  removeWire(id: string): void;
  setParam(nodeId: string, paramId: string, value: number): void;
  setName(name: string): void;

  selectNode(id: string | null): void;
  selectWire(id: string | null): void;
  hoverTracePin(pin: PinRef | null): void;
  hoverTraceWire(wireId: string | null): void;
  pinTracePin(pin: PinRef): void;
  pinTraceWire(wireId: string): void;
  clearTrace(): void;
  clearSelection(): void;

  beginDrag(): void;
  undo(): void;
  showToast(msg: string): void;
  dismissToast(): void;

  exportJson(): string;
  importJson(json: string): boolean;
  newDesign(): void;
  setAudioRunning(v: boolean): void;
}

let history: Design[] = [];
let lastParamStamp = { key: '', time: 0 };

const snapshot = (d: Design) => {
  history.push(structuredClone(d));
  if (history.length > HISTORY_MAX) history.shift();
};

export const useApp = create<AppState>((set, get) => {
  const commitStructural = (design: Design) => {
    set({ design });
    saveSoon(design);
    engine.requestRebuild(design);
  };

  return {
    design: loadSaved() ?? emptyDesign(),
    ui: {
      selectedNodeId: null,
      selectedWireId: null,
      trace: null,
      tracePinned: false,
      toast: null,
    },
    audioRunning: false,

    /* -------------------------------------------------------- nodes */

    addNode(type, x, y) {
      const spec = registry[type];
      if (!spec) return;
      snapshot(get().design);
      const d = get().design;
      const count = d.nodes.filter((n) => n.type === type).length + 1;
      const params: Record<string, number> = {};
      for (const p of spec.params) params[p.id] = p.default;
      const node: NodeInstance = {
        id: uid('n'),
        type,
        label: `${spec.name} ${count}`,
        x: Math.round(x),
        y: Math.round(y),
        params,
      };
      commitStructural({ ...d, nodes: [...d.nodes, node] });
      set((s) => ({
        ui: { ...s.ui, selectedNodeId: node.id, selectedWireId: null },
      }));
    },

    moveNode(id, x, y) {
      const d = get().design;
      const design = {
        ...d,
        nodes: d.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
      };
      set({ design });
      saveSoon(design); // position-only: no rebuild, no snapshot (beginDrag did)
    },

    removeNode(id) {
      const d = get().design;
      if (!d.nodes.some((n) => n.id === id)) return;
      snapshot(d);
      const design: Design = {
        ...d,
        nodes: d.nodes.filter((n) => n.id !== id),
        wires: d.wires.filter(
          (w) => w.from.nodeId !== id && w.to.nodeId !== id,
        ),
      };
      commitStructural(design);
      set((s) => ({
        ui: {
          ...s.ui,
          selectedNodeId:
            s.ui.selectedNodeId === id ? null : s.ui.selectedNodeId,
          trace: null,
          tracePinned: false,
        },
      }));
    },

    /* -------------------------------------------------------- wires */

    addWire(a, b) {
      const d = get().design;
      const dirOf = (r: PinRef) => {
        const n = d.nodes.find((x) => x.id === r.nodeId);
        return n
          ? registry[n.type]?.pins.find((p) => p.id === r.pinId)?.direction
          : undefined;
      };
      let from = a;
      let to = b;
      if (dirOf(a) === 'in' && dirOf(b) === 'out') {
        from = b;
        to = a;
      }
      if (dirOf(from) !== 'out' || dirOf(to) !== 'in') return;

      if (from.nodeId === to.nodeId) {
        get().showToast('A component cannot feed itself.');
        return;
      }
      const inKey = `${to.nodeId}:${to.pinId}`;
      if (d.wires.some((w) => `${w.to.nodeId}:${w.to.pinId}` === inKey)) {
        get().showToast('Inputs accept one wire — use a Mixer to sum.');
        return;
      }
      // cycle check (node-level, conservative)
      const adj = new Map<string, string[]>();
      for (const w of d.wires)
        (adj.get(w.from.nodeId) ?? adj.set(w.from.nodeId, []).get(w.from.nodeId)!).push(
          w.to.nodeId,
        );
      const stack = [to.nodeId];
      const seen = new Set<string>();
      let cyclic = false;
      while (stack.length) {
        const n = stack.pop()!;
        if (n === from.nodeId) {
          cyclic = true;
          break;
        }
        if (seen.has(n)) continue;
        seen.add(n);
        for (const m of adj.get(n) ?? []) stack.push(m);
      }
      if (cyclic) {
        get().showToast('That would create a feedback loop.');
        return;
      }

      snapshot(d);
      const wire: Wire = {
        id: uid('w'),
        from,
        to,
        colorIndex: (d.wires.length % 4) + 1,
      };
      commitStructural({ ...d, wires: [...d.wires, wire] });
    },

    removeWire(id) {
      const d = get().design;
      if (!d.wires.some((w) => w.id === id)) return;
      snapshot(d);
      commitStructural({ ...d, wires: d.wires.filter((w) => w.id !== id) });
      set((s) => ({
        ui: {
          ...s.ui,
          selectedWireId:
            s.ui.selectedWireId === id ? null : s.ui.selectedWireId,
          trace: null,
          tracePinned: false,
        },
      }));
    },

    /* ------------------------------------------------------- params */

    setParam(nodeId, paramId, value) {
      const key = `${nodeId}:${paramId}`;
      const now = Date.now();
      if (lastParamStamp.key !== key || now - lastParamStamp.time > 800) {
        snapshot(get().design);
      }
      lastParamStamp = { key, time: now };

      const d = get().design;
      const design = {
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, params: { ...n.params, [paramId]: value } }
            : n,
        ),
      };
      set({ design });
      saveSoon(design);
      engine.setParam(nodeId, paramId, value); // live, no rebuild
    },

    setName(name) {
      const design = { ...get().design, name };
      set({ design });
      saveSoon(design);
    },

    /* ---------------------------------------------- selection/trace */

    selectNode(id) {
      set((s) => ({
        ui: { ...s.ui, selectedNodeId: id, selectedWireId: null },
      }));
    },
    selectWire(id) {
      set((s) => ({
        ui: { ...s.ui, selectedWireId: id, selectedNodeId: null },
      }));
    },

    hoverTracePin(pin) {
      const s = get();
      if (s.ui.tracePinned) return;
      set({
        ui: {
          ...s.ui,
          trace: pin ? computeTrace(s.design, pin) : null,
        },
      });
    },
    hoverTraceWire(wireId) {
      const s = get();
      if (s.ui.tracePinned) return;
      set({
        ui: {
          ...s.ui,
          trace: wireId ? computeTraceFromWire(s.design, wireId) : null,
        },
      });
    },
    pinTracePin(pin) {
      const s = get();
      set({
        ui: { ...s.ui, trace: computeTrace(s.design, pin), tracePinned: true },
      });
    },
    pinTraceWire(wireId) {
      const s = get();
      const trace = computeTraceFromWire(s.design, wireId);
      if (trace) set({ ui: { ...s.ui, trace, tracePinned: true } });
    },
    clearTrace() {
      set((s) => ({ ui: { ...s.ui, trace: null, tracePinned: false } }));
    },
    clearSelection() {
      set((s) => ({
        ui: {
          ...s.ui,
          selectedNodeId: null,
          selectedWireId: null,
          trace: null,
          tracePinned: false,
        },
      }));
    },

    /* ------------------------------------------------ history/toast */

    beginDrag() {
      snapshot(get().design);
    },

    undo() {
      const prev = history.pop();
      if (!prev) return;
      const design = prev;
      set((s) => ({
        design,
        ui: { ...s.ui, trace: null, tracePinned: false },
      }));
      saveSoon(design);
      engine.requestRebuild(design);
    },

    showToast(msg) {
      set((s) => ({ ui: { ...s.ui, toast: { id: Date.now(), msg } } }));
    },
    dismissToast() {
      set((s) => ({ ui: { ...s.ui, toast: null } }));
    },

    /* ------------------------------------------------ import/export */

    exportJson() {
      return JSON.stringify(get().design, null, 2);
    },

    importJson(json) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        get().showToast('Import failed: not valid JSON.');
        return false;
      }
      const design = sanitizeDesign(parsed);
      if (!design) {
        get().showToast('Import failed: not a PatchLab v1 design.');
        return false;
      }
      snapshot(get().design);
      commitStructural(design);
      set((s) => ({
        ui: {
          ...s.ui,
          selectedNodeId: null,
          selectedWireId: null,
          trace: null,
          tracePinned: false,
        },
      }));
      return true;
    },

    newDesign() {
      snapshot(get().design);
      commitStructural(emptyDesign());
      set((s) => ({
        ui: {
          ...s.ui,
          selectedNodeId: null,
          selectedWireId: null,
          trace: null,
          tracePinned: false,
        },
      }));
    },

    setAudioRunning(v) {
      set({ audioRunning: v });
    },
  };
});

// keep the Start Audio pill honest if the OS suspends the context
engine.onStateChange = (running) => useApp.getState().setAudioRunning(running);
