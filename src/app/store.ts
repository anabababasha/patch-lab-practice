import { create } from 'zustand';
import type { Design, NodeInstance, PinRef, Wire } from '../lib/types';
import { registry, typeAliases } from '../components/registry';
import { computeTrace, computeTraceFromWire } from '../graph/trace';
import type { TraceResult } from '../graph/trace';
import { engine } from '../audio/engine';
import { micManager } from '../audio/mediaCache';

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
    const src = n as NodeInstance;
    const resolvedType = typeAliases[src.type] ?? src.type;
    const spec = registry[resolvedType];
    if (!spec) continue; // unknown component type -> drop
    const params: Record<string, number> = {};
    for (const p of spec.params) {
      const v = src.params?.[p.id];
      params[p.id] =
        typeof v === 'number' && Number.isFinite(v)
          ? Math.min(p.max, Math.max(p.min, v))
          : p.default;
    }
    let meta: Record<string, string> | undefined;
    if (src.meta && typeof src.meta === 'object') {
      meta = {};
      for (const [k, val] of Object.entries(src.meta)) {
        if (typeof val === 'string' && k.length <= 40 && val.length <= 200)
          meta[k] = val;
      }
      if (Object.keys(meta).length === 0) meta = undefined;
    }
    nodes.push({
      id: typeof src.id === 'string' ? src.id : uid('n'),
      type: spec.type,
      label: typeof src.label === 'string' ? src.label : spec.name,
      x: typeof src.x === 'number' ? src.x : 0,
      y: typeof src.y === 'number' ? src.y : 0,
      params,
      ...(meta ? { meta } : {}),
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const pinSpec = (r: PinRef, dir: 'in' | 'out') => {
    if (!r || !nodeIds.has(r.nodeId)) return undefined;
    const node = nodes.find((n) => n.id === r.nodeId)!;
    return registry[node.type].pins.find(
      (p) => p.id === r.pinId && p.direction === dir,
    );
  };

  const wires: Wire[] = [];
  const takenInputs = new Set<string>();
  for (const w of d.wires) {
    if (!w || typeof w !== 'object') continue;
    const src = w as Wire;
    const fromPin = pinSpec(src.from, 'out');
    const toPin = pinSpec(src.to, 'in');
    if (!fromPin || !toPin || fromPin.kind !== toPin.kind) continue;
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
      kind: fromPin.kind,
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

type TraceSource =
  | { kind: 'pin'; pin: PinRef }
  | { kind: 'wire'; wireId: string };

interface UiState {
  selectedNodeIds: string[];
  selectedWireId: string | null;
  trace: TraceResult | null;
  traceSource: TraceSource | null;
  tracePinned: boolean;
  toast: { id: number; msg: string } | null;
  rejections: string[];
  panelOpen: boolean;
}

interface AppState {
  design: Design;
  ui: UiState;
  audioRunning: boolean;
  canUndo: boolean;
  canRedo: boolean;

  addNode(type: string, x: number, y: number): void;
  moveNode(id: string, x: number, y: number): void;
  removeNodes(ids: string[]): void;
  removeNode(id: string): void;
  addWire(a: PinRef, b: PinRef): void;
  removeWire(id: string): void;
  setParam(nodeId: string, paramId: string, value: number): void;
  setName(name: string): void;
  setNodeMeta(nodeId: string, key: string, value: string): void;
  loadMediaFile(nodeId: string, file: File): Promise<void>;

  setSelectedNodes(ids: string[]): void;
  addToSelection(id: string): void;
  selectAll(): void;
  selectWire(id: string | null): void;
  hoverTracePin(pin: PinRef | null): void;
  hoverTraceWire(wireId: string | null): void;
  pinTracePin(pin: PinRef): void;
  pinTraceWire(wireId: string): void;
  clearTrace(): void;
  clearSelection(): void;
  setPanelOpen(open: boolean): void;

  beginDrag(): void;
  undo(): void;
  redo(): void;
  showToast(msg: string): void;
  dismissToast(): void;

  exportJson(): string;
  importJson(json: string): boolean;
  newDesign(): void;
  setAudioRunning(v: boolean): void;
}

let history: Design[] = [];
let redoStack: Design[] = [];
let lastParamStamp = { key: '', time: 0 };

const updateHistoryState = () => {
  useApp.setState({
    canUndo: history.length > 0,
    canRedo: redoStack.length > 0,
  });
};

const snapshot = (d: Design) => {
  history.push(structuredClone(d));
  if (history.length > HISTORY_MAX) history.shift();
  redoStack = [];
  updateHistoryState();
};

export const useApp = create<AppState>((set, get) => {
  const commitStructural = (design: Design) => {
    set({ design });
    saveSoon(design);
    engine.requestRebuild(design);
  };

  /** Recompute the active trace against the current design (e.g. after a
   *  Router crosspoint flips — dynamic routing must move the glow). */
  const retrace = () => {
    const s = get();
    const src = s.ui.traceSource;
    if (!src || !s.ui.trace) return;
    const trace =
      src.kind === 'pin'
        ? computeTrace(s.design, src.pin)
        : computeTraceFromWire(s.design, src.wireId);
    set((st) => ({ ui: { ...st.ui, trace } }));
  };

  return {
    design: loadSaved() ?? emptyDesign(),
    ui: {
      selectedNodeIds: [],
      selectedWireId: null,
      trace: null,
      traceSource: null,
      tracePinned: false,
      toast: null,
      rejections: [],
      panelOpen: typeof window !== 'undefined' && window.innerWidth >= 1024,
    },
    audioRunning: false,
    canUndo: false,
    canRedo: false,

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
        ui: { ...s.ui, selectedNodeIds: [node.id], selectedWireId: null },
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

    removeNodes(ids) {
      if (ids.length === 0) return;
      const d = get().design;
      const idSet = new Set(ids);
      if (!d.nodes.some((n) => idSet.has(n.id))) return;
      snapshot(d);
      const design: Design = {
        ...d,
        nodes: d.nodes.filter((n) => !idSet.has(n.id)),
        wires: d.wires.filter(
          (w) => !idSet.has(w.from.nodeId) && !idSet.has(w.to.nodeId),
        ),
      };
      commitStructural(design);
      set((s) => ({
        ui: {
          ...s.ui,
          selectedNodeIds: s.ui.selectedNodeIds.filter((id) => !idSet.has(id)),
          trace: null,
          traceSource: null,
          tracePinned: false,
        },
      }));
    },

    removeNode(id) {
      get().removeNodes([id]);
    },

    /* -------------------------------------------------------- wires */

    addWire(a, b) {
      const d = get().design;
      const pinOf = (r: PinRef) => {
        const n = d.nodes.find((x) => x.id === r.nodeId);
        return n
          ? registry[n.type]?.pins.find((p) => p.id === r.pinId)
          : undefined;
      };
      let from = a;
      let to = b;
      if (pinOf(a)?.direction === 'in' && pinOf(b)?.direction === 'out') {
        from = b;
        to = a;
      }
      const fromPin = pinOf(from);
      const toPin = pinOf(to);
      if (fromPin?.direction !== 'out' || toPin?.direction !== 'in') return;

      const reject = (msg: string) => {
        set((s) => ({
          ui: {
            ...s.ui,
            toast: { id: Date.now(), msg },
            rejections: [msg, ...s.ui.rejections].slice(0, 5),
          },
        }));
      };

      if (fromPin.kind !== toPin.kind) {
        reject('Signal kinds must match — control outs (dashed) go to Mod inputs.');
        return;
      }
      if (from.nodeId === to.nodeId) {
        reject('A component cannot feed itself.');
        return;
      }
      const inKey = `${to.nodeId}:${to.pinId}`;
      if (d.wires.some((w) => `${w.to.nodeId}:${w.to.pinId}` === inKey)) {
        reject('Inputs accept one wire — use a Mixer to sum.');
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
        reject('That would create a feedback loop.');
        return;
      }

      snapshot(d);
      const wire: Wire = {
        id: uid('w'),
        from,
        to,
        colorIndex: (d.wires.length % 4) + 1,
        kind: fromPin.kind,
      };
      commitStructural({ ...d, wires: [...d.wires, wire] });
      retrace();
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
          traceSource: null,
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
      retrace(); // dynamic routing (Router) can change the traced path
    },

    setNodeMeta(nodeId, key, value) {
      const d = get().design;
      const design = {
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === nodeId ? { ...n, meta: { ...n.meta, [key]: value } } : n,
        ),
      };
      set({ design });
      saveSoon(design);
    },

    async loadMediaFile(nodeId, file) {
      try {
        const name = await engine.loadMedia(nodeId, file);
        get().setNodeMeta(nodeId, 'file', name);
        get().showToast(`Loaded "${name}"`);
      } catch {
        get().showToast('Could not decode that audio file.');
      }
    },

    setName(name) {
      const design = { ...get().design, name };
      set({ design });
      saveSoon(design);
    },

    /* ---------------------------------------------- selection/trace */

    setSelectedNodes(ids) {
      set((s) => ({
        ui: { ...s.ui, selectedNodeIds: ids, selectedWireId: null },
      }));
    },
    addToSelection(id) {
      set((s) => {
        if (s.ui.selectedNodeIds.includes(id)) return s;
        return {
          ui: { ...s.ui, selectedNodeIds: [...s.ui.selectedNodeIds, id], selectedWireId: null },
        };
      });
    },
    selectAll() {
      set((s) => ({
        ui: { ...s.ui, selectedNodeIds: s.design.nodes.map(n => n.id), selectedWireId: null },
      }));
    },
    selectWire(id) {
      set((s) => ({
        ui: { ...s.ui, selectedWireId: id, selectedNodeIds: [] },
      }));
    },

    hoverTracePin(pin) {
      const s = get();
      if (s.ui.tracePinned) return;
      set({
        ui: {
          ...s.ui,
          trace: pin ? computeTrace(s.design, pin) : null,
          traceSource: pin ? { kind: 'pin', pin } : null,
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
          traceSource: wireId ? { kind: 'wire', wireId } : null,
        },
      });
    },
    pinTracePin(pin) {
      const s = get();
      set({
        ui: {
          ...s.ui,
          trace: computeTrace(s.design, pin),
          traceSource: { kind: 'pin', pin },
          tracePinned: true,
        },
      });
    },
    pinTraceWire(wireId) {
      const s = get();
      const trace = computeTraceFromWire(s.design, wireId);
      if (trace)
        set({
          ui: {
            ...s.ui,
            trace,
            traceSource: { kind: 'wire', wireId },
            tracePinned: true,
          },
        });
    },
    clearTrace() {
      set((s) => ({
        ui: { ...s.ui, trace: null, traceSource: null, tracePinned: false },
      }));
    },
    clearSelection() {
      set((s) => ({
        ui: {
          ...s.ui,
          selectedNodeIds: [],
          selectedWireId: null,
          trace: null,
          traceSource: null,
          tracePinned: false,
        },
      }));
    },
    setPanelOpen(open) {
      set((s) => ({ ui: { ...s.ui, panelOpen: open } }));
    },

    /* ------------------------------------------------ history/toast */

    beginDrag() {
      snapshot(get().design);
    },

    undo() {
      const prev = history.pop();
      if (!prev) return;
      redoStack.push(structuredClone(get().design));
      const design = prev;
      set((s) => ({
        design,
        ui: { ...s.ui, trace: null, traceSource: null, tracePinned: false },
      }));
      updateHistoryState();
      saveSoon(design);
      engine.requestRebuild(design);
    },

    redo() {
      const next = redoStack.pop();
      if (!next) return;
      history.push(structuredClone(get().design));
      const design = next;
      set((s) => ({
        design,
        ui: { ...s.ui, trace: null, traceSource: null, tracePinned: false },
      }));
      updateHistoryState();
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
          selectedNodeIds: [],
          selectedWireId: null,
          trace: null,
          traceSource: null,
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
          selectedNodeIds: [],
          selectedWireId: null,
          trace: null,
          traceSource: null,
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
micManager.onDenied = (msg) => useApp.getState().showToast(msg);
