import { create } from 'zustand';
import type { Design, NodeInstance, PinRef, Wire } from '../lib/types';
import { registry, typeAliases } from '../components/registry';
import { computeTrace, computeTraceFromWire } from '../graph/trace';
import type { TraceResult } from '../graph/trace';
import { engine } from '../audio/engine';
import { transportService } from '../audio/transportService';
import { recorderService } from '../audio/recorderService';
import { looperService } from '../audio/looperService';
import { micManager } from '../audio/mediaCache';

const STORAGE_KEY = 'patchlab.design.v1';
const HISTORY_MAX = 50;

const uid = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

const emptyDesign = (): Design => ({
  version: 1,
  name: 'Untitled system',
  layers: [{ id: 'main', name: 'Main' }],
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

  const layers = Array.isArray(d.layers) && d.layers.length > 0 
    ? d.layers 
    : [{ id: 'main', name: 'Main' }];
  
  // Dedupe layers
  const uniqueLayers = [];
  const seenLayerIds = new Set<string>();
  for (const l of layers) {
    if (l && typeof l === 'object' && l.id && typeof l.id === 'string' && l.name && typeof l.name === 'string') {
      if (!seenLayerIds.has(l.id)) {
        seenLayerIds.add(l.id);
        uniqueLayers.push(l);
      }
    }
  }
  if (uniqueLayers.length === 0) {
    uniqueLayers.push({ id: 'main', name: 'Main' });
    seenLayerIds.add('main');
  }
  
  const firstLayerId = uniqueLayers[0].id;

  const nodes: NodeInstance[] = [];
  for (const n of d.nodes) {
    if (!n || typeof n !== 'object') continue;
    const src = n as NodeInstance;
    const resolvedType = typeAliases[src.type] ?? src.type;
    const spec = registry[resolvedType];
    if (!spec) {
      console.warn(`sanitizeDesign: Dropped node '${src.id}' — unknown type '${src.type}'`);
      continue;
    }
    const params: Record<string, number> = {};
    for (const p of spec.params) {
      const v = src.params?.[p.id];
      params[p.id] =
        typeof v === 'number' && Number.isFinite(v)
          ? Math.min(p.max, Math.max(p.min, v))
          : p.default;
    }
    if (src.params) {
      for (const key of Object.keys(src.params)) {
        if (!spec.params.some((p) => p.id === key)) {
          console.warn(`sanitizeDesign: Dropped param '${key}' on node '${src.id}' (type '${spec.type}')`);
        }
      }
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
      layerId: typeof src.layerId === 'string' && seenLayerIds.has(src.layerId) ? src.layerId : firstLayerId,
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
    if (!fromPin) {
      console.warn(`sanitizeDesign: Dropped wire '${src.id}' — fromPin '${src.from?.pinId}' not found on node '${src.from?.nodeId}'`);
      continue;
    }
    if (!toPin) {
      console.warn(`sanitizeDesign: Dropped wire '${src.id}' — toPin '${src.to?.pinId}' not found on node '${src.to?.nodeId}'`);
      continue;
    }
    if (fromPin.kind !== toPin.kind) {
      console.warn(`sanitizeDesign: Dropped wire '${src.id}' — kind mismatch ('${fromPin.kind}' vs '${toPin.kind}')`);
      continue;
    }
    const inKey = `${src.to.nodeId}:${src.to.pinId}`;
    if (takenInputs.has(inKey)) {
      console.warn(`sanitizeDesign: Dropped wire '${src.id}' — input '${inKey}' already taken`);
      continue;
    }
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
    layers: uniqueLayers,
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
  panelTab: 'info' | 'check' | 'patterns';
  activeLayerId: string;
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
  setParamsBulk(nodeId: string, values: Record<string, number>, meta?: Record<string, string>): void;
  setName(name: string): void;
  setNodeMeta(nodeId: string, key: string, value: string): void;
  loadMediaFile(nodeId: string, file: File): Promise<void>;
  fireTrigger(nodeId: string, pinId: string): void;
  
  addLayer(): void;
  renameLayer(id: string, name: string): void;
  deleteLayer(id: string): void;
  setActiveLayer(id: string): void;
  moveNodesToLayer(nodeIds: string[], layerId: string): void;

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
  setPanelTab(tab: 'info' | 'check' | 'patterns'): void;

  beginDrag(): void;
  undo(): void;
  redo(): void;
  showToast(msg: string): void;
  dismissToast(): void;

  exportJson(): string;
  importJson(json: string): boolean;
  newDesign(): void;
  insertExample(design: Design, name: string): void;
  setAudioRunning(v: boolean): void;
  startRecording(nodeId: string): void;
  stopRecording(nodeId: string): void;
  looperAction(nodeId: string, sync: boolean): void;
  looperClear(nodeId: string): void;

  transport: { playing: boolean; bpm: number };
  setBpm(v: number): void;
  toggleTransport(): void;
}

let history: Design[] = [];
let redoStack: Design[] = [];
let lastParamStamp = { key: '', time: 0 };
let shownAutoStartToast = false;

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
      panelTab: 'info',
      activeLayerId: 'all',
    },
    audioRunning: false,
    canUndo: false,
    canRedo: false,
    transport: { playing: false, bpm: 100 },

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
        layerId: get().ui.activeLayerId === 'all' ? (get().design.layers?.[0]?.id ?? 'main') : get().ui.activeLayerId,
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

    async fireTrigger(nodeId, pinId) {
      if (!get().audioRunning) {
        await engine.start(get().design);
        get().setAudioRunning(true);
        if (!shownAutoStartToast) {
          shownAutoStartToast = true;
          get().showToast('Audio started — tap TRIG again to hear it');
        }
      }
      engine.emitTrigger(nodeId, pinId);
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
        reject('Signal kinds must match — audio to audio, dashed control to Mod, dotted trigger to Trig.');
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

    setParamsBulk(nodeId, values, meta) {
      const s = get();
      const node = s.design.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      snapshot(s.design);

      const nextNodes = s.design.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const newMeta = meta ? { ...n.meta, ...meta } : n.meta;
        if (newMeta && Object.keys(newMeta).length === 0) {
          // keep it clean if empty
        }
        return { ...n, params: { ...n.params, ...values }, meta: newMeta };
      });

      const nextDesign = { ...s.design, nodes: nextNodes };
      set({ design: nextDesign });
      saveSoon(nextDesign);

      for (const [k, v] of Object.entries(values)) {
        engine.setParam(nodeId, k, v);
      }
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
    
    addLayer() {
      const d = get().design;
      const layers = d.layers ?? [{ id: 'main', name: 'Main' }];
      let num = layers.length + 1;
      let name = `Layer ${num}`;
      while (layers.some(l => l.name === name)) {
        num++;
        name = `Layer ${num}`;
      }
      const newLayer = { id: uid('layer'), name };
      snapshot(d);
      const nextDesign = { ...d, layers: [...layers, newLayer] };
      commitStructural(nextDesign);
      set(s => ({ ui: { ...s.ui, activeLayerId: newLayer.id } }));
    },
    
    renameLayer(id, name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const d = get().design;
      const layers = d.layers ?? [{ id: 'main', name: 'Main' }];
      if (!layers.some(l => l.id === id)) return;
      
      const now = Date.now();
      const key = `layer_rename:${id}`;
      if (lastParamStamp.key !== key || now - lastParamStamp.time > 800) {
        snapshot(d);
      }
      lastParamStamp = { key, time: now };
      
      const nextDesign = {
        ...d,
        layers: layers.map(l => l.id === id ? { ...l, name: trimmed } : l)
      };
      set({ design: nextDesign });
      saveSoon(nextDesign);
    },
    
    deleteLayer(id) {
      const d = get().design;
      const layers = d.layers ?? [{ id: 'main', name: 'Main' }];
      if (layers.length <= 1) {
        get().showToast("A design needs at least one layer.");
        return;
      }
      const layerIndex = layers.findIndex(l => l.id === id);
      if (layerIndex === -1) return;
      
      snapshot(d);
      const remainingLayers = layers.filter(l => l.id !== id);
      const targetLayerId = remainingLayers[0].id;
      
      const nextNodes = d.nodes.map(n => n.layerId === id ? { ...n, layerId: targetLayerId } : n);
      const nextDesign = { ...d, layers: remainingLayers, nodes: nextNodes };
      
      commitStructural(nextDesign);
      
      if (get().ui.activeLayerId === id) {
        set(s => ({ ui: { ...s.ui, activeLayerId: 'all' } }));
      }
    },
    
    setActiveLayer(id) {
      set(s => ({ ui: { ...s.ui, activeLayerId: id } }));
    },
    
    moveNodesToLayer(nodeIds, layerId) {
      const d = get().design;
      const layers = d.layers ?? [{ id: 'main', name: 'Main' }];
      if (!layers.some(l => l.id === layerId)) return;
      
      snapshot(d);
      const idSet = new Set(nodeIds);
      const nextNodes = d.nodes.map(n => idSet.has(n.id) ? { ...n, layerId } : n);
      commitStructural({ ...d, nodes: nextNodes });
    },

    setPanelOpen(open) {
      set((s) => ({ ui: { ...s.ui, panelOpen: open } }));
    },
    setPanelTab(tab) {
      set((s) => ({ ui: { ...s.ui, panelTab: tab } }));
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

    insertExample(design, name) {
      const sanitized = sanitizeDesign(design);
      if (!sanitized) return;

      snapshot(get().design);
      const d = get().design;

      let offsetX = 0;
      if (d.nodes.length > 0) {
        let maxX = -Infinity;
        for (const n of d.nodes) if (n.x > maxX) maxX = n.x;
        
        let minIncomingX = Infinity;
        for (const n of sanitized.nodes) if (n.x < minIncomingX) minIncomingX = n.x;

        if (maxX !== -Infinity && minIncomingX !== Infinity) {
          offsetX = (maxX + 120) - minIncomingX;
        }
      }

      const typeCounts = new Map<string, number>();
      for (const n of d.nodes) {
        typeCounts.set(n.type, (typeCounts.get(n.type) || 0) + 1);
      }

      const incomingNodes = sanitized.nodes.map(n => {
        const count = (typeCounts.get(n.type) || 0) + 1;
        typeCounts.set(n.type, count);
        const spec = registry[n.type];
        const label = spec ? `${spec.name} ${count}` : n.label;
        return {
          ...n,
          x: n.x + offsetX,
          label,
          layerId: get().ui.activeLayerId === 'all' ? (get().design.layers?.[0]?.id ?? 'main') : get().ui.activeLayerId,
        };
      });

      const mergedDesign = {
        ...d,
        nodes: [...d.nodes, ...incomingNodes],
        wires: [...d.wires, ...sanitized.wires],
      };

      commitStructural(mergedDesign);

      const incomingIds = incomingNodes.map(n => n.id);

      set((s) => ({
        ui: {
          ...s.ui,
          selectedNodeIds: incomingIds,
          selectedWireId: null,
          trace: null,
          traceSource: null,
          tracePinned: false,
        },
      }));

      get().showToast(`${name} added — drag to position it`);
    },

    setAudioRunning(v) {
      set({ audioRunning: v });
    },

    setBpm(v) {
      const clamped = Math.max(40, Math.min(240, v));
      transportService.setBpm(clamped);
      set((s) => ({ transport: { ...s.transport, bpm: clamped } }));
    },

    async toggleTransport() {
      const s = get();
      if (!s.transport.playing) {
        if (!s.audioRunning) {
          await engine.start(s.design);
          get().setAudioRunning(true);
          if (!shownAutoStartToast) {
            shownAutoStartToast = true;
            get().showToast('Audio started');
          }
        }
        transportService.start();
        set((s) => ({ transport: { ...s.transport, playing: true } }));
      } else {
        transportService.stop();
        set((s) => ({ transport: { ...s.transport, playing: false } }));
      }
    },
    startRecording(nodeId) {
      const doStart = () => {
        const ctx = engine.context;
        const node = get().design.nodes.find(n => n.id === nodeId);
        const format = node?.params['format'] ?? 0;
        if (ctx) recorderService.start(ctx, nodeId, get().design.name, format);
      };

      if (!get().audioRunning) {
        engine.start(get().design).then(running => {
          set({ audioRunning: running });
          if (running) {
            if (!shownAutoStartToast) {
              shownAutoStartToast = true;
              get().showToast('Audio started');
            }
            setTimeout(doStart, 50); // let nodes build
          }
        });
      } else {
        doStart();
      }
    },

    stopRecording(nodeId) {
      const ctx = engine.context;
      if (ctx) {
        recorderService.stop(ctx, nodeId);
      }
    },

    looperAction(nodeId, sync) {
      const doAction = () => {
        const ctx = engine.context;
        if (ctx) {
          looperService.action(ctx, nodeId, sync);
        }
      };

      if (!get().audioRunning) {
        engine.start(get().design).then(running => {
          set({ audioRunning: running });
          if (running) {
            if (!shownAutoStartToast) {
              shownAutoStartToast = true;
              get().showToast('Audio started');
            }
            setTimeout(doAction, 50); // let nodes build
          }
        });
      } else {
        doAction();
      }
    },

    looperClear(nodeId) {
      const ctx = engine.context;
      if (ctx) {
        looperService.clear(ctx, nodeId);
      }
    }
  };
});

// keep the Start Audio pill honest if the OS suspends the context
engine.onStateChange = (running) => useApp.getState().setAudioRunning(running);
micManager.onDenied = (msg) => useApp.getState().showToast(msg);
recorderService.onToast = (msg) => useApp.getState().showToast(msg);
