import type { AudioUnit, Design, NodeInstance, Wire } from '../lib/types';
import { registry } from '../components/registry';
import { eqService } from './eqService';
import { meterService } from './meterService';
import { scopeService } from './scopeService';
import { mediaCache } from './mediaCache';
import { midiService } from './midiService';
import { transportService } from './transportService';
import { triggerBus } from './triggerBus';
import { recorderService } from './recorderService';
import { looperService } from './looperService';
import { ensureCaptureWorklet } from './captureWorklet';
import { ensureGrainWorklet } from './grainWorklet';
import { resolveParamValue } from './sync';

/**
 * Compile strategy: correctness over cleverness.
 *  - structural change  -> debounced 50 ms splice rebuild with full fallback
 *  - param change       -> bind() only (setTargetAtTime, zero rebuilds)
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private units = new Map<string, AudioUnit>();
  private unitTypes = new Map<string, string>();
  private triggerMap = new Map<string, Array<(time?: number) => void>>();
  private timer: number | undefined;
  private lastDesign: Design | null = null;
  private lastBuilt: Design | null = null;
  private fadePending = false;
  onStateChange: ((running: boolean) => void) | null = null;

  constructor() {
    triggerBus.emit = (n, p, t) => this.emitTrigger(n, p, t);
  }

  get context() {
    return this.ctx;
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.ctx.addEventListener('statechange', () => {
        this.onStateChange?.(this.ctx?.state === 'running');
      });
      transportService.attach(this.ctx);
    }
    return this.ctx;
  }

  /** User-gesture gate: builds the current design, then resumes. */
  async start(design: Design): Promise<boolean> {
    const ctx = this.ensure();
    this.lastDesign = design;
    await ctx.resume();
    await ensureCaptureWorklet(ctx);
    await ensureGrainWorklet(ctx);
    this.rebuild(design);
    return ctx.state === 'running';
  }

  async suspend(): Promise<void> {
    await this.ctx?.suspend();
  }

  /** Call on any node/wire add/remove (or full design swap). */
  requestRebuild(design: Design) {
    this.lastDesign = design;
    if (!this.ctx) return; // nothing audible yet; start() will build fresh
    const incoming = new Map(design.nodes.map(n => [n.id, n.type]));
    const removing = Array.from(this.units.keys()).filter(id => incoming.get(id) !== this.unitTypes.get(id));
    if (removing.length > 0 && !this.fadePending) {
      this.fadePending = true;
      for (const id of removing) {
        const unit = this.units.get(id);
        try {
          unit?.prepareTeardown?.(this.ctx.currentTime);
        } catch {
          /* one bad pre-fade must not abort the rebuild burst */
        }
      }
    }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.lastDesign) this.rebuild(this.lastDesign);
    }, 50);
  }

  private rebuild(design: Design) {
    this.fadePending = false;
    const ctx = this.ctx;
    if (!ctx) return;

    try {
      this.spliceRebuild(ctx, design);
    } catch (e) {
      console.warn('[rebuild] splice failed, full rebuild', e);
      this.fullRebuild(ctx, design);
    }
  }

  private spliceRebuild(ctx: AudioContext, design: Design) {
    const nextNodes = new Map(design.nodes.map(n => [n.id, n]));
    const removedIds = new Set<string>();
    for (const id of this.units.keys()) {
      const next = nextNodes.get(id);
      if (!next || this.unitTypes.get(id) !== next.type) removedIds.add(id);
    }

    const createdNodes: NodeInstance[] = [];
    const keptNodes: NodeInstance[] = [];
    for (const node of design.nodes) {
      if (!this.units.has(node.id) || removedIds.has(node.id)) {
        createdNodes.push(node);
      } else {
        keptNodes.push(node);
      }
    }

    for (const id of removedIds) {
      const unit = this.units.get(id);
      try {
        unit?.dispose();
      } catch {
        /* bare .disconnect() on an unwired node throws in some browsers; ignore */
      }
      this.units.delete(id);
      this.unitTypes.delete(id);
    }

    const createdIds = new Set(createdNodes.map(n => n.id));
    const keptIds = new Set(keptNodes.map(n => n.id));

    for (const node of createdNodes) {
      this.createUnit(ctx, node);
    }

    for (const node of keptNodes) {
      const unit = this.units.get(node.id);
      if (unit) this.bindUnitParams(unit, node);
    }

    const beforeWires = this.physicalWireMap(this.lastBuilt?.wires ?? []);
    const afterWires = this.physicalWireMap(design.wires);
    let wiresDisconnected = 0;
    let wiresConnected = 0;

    for (const [key, wire] of beforeWires.entries()) {
      if (afterWires.has(key)) continue;
      wiresDisconnected += 1;
      if (keptIds.has(wire.from.nodeId) && keptIds.has(wire.to.nodeId)) {
        this.disconnectWire(wire);
      }
    }

    for (const [key, wire] of afterWires.entries()) {
      const endpointCreated = createdIds.has(wire.from.nodeId) || createdIds.has(wire.to.nodeId);
      if (beforeWires.has(key) && !endpointCreated) continue;
      this.connectWire(wire);
      wiresConnected += 1;
    }

    this.rebuildTriggerMap(design);
    this.refreshServices(ctx, design);
    this.lastBuilt = design;

    console.debug('[rebuild] splice', {
      created: createdNodes.length,
      removed: removedIds.size,
      kept: keptNodes.length,
      'wires+': wiresConnected,
      'wires-': wiresDisconnected,
    });
  }

  private fullRebuild(ctx: AudioContext, design: Design) {
    for (const unit of this.units.values()) {
      try {
        unit.dispose();
      } catch {
        /* bare .disconnect() on an unwired node throws in some browsers; ignore */
      }
    }
    this.units.clear();
    this.unitTypes.clear();

    for (const node of design.nodes) {
      this.createUnit(ctx, node);
    }

    for (const wire of design.wires) {
      if ((wire.kind ?? 'audio') === 'trigger') continue;
      this.connectWire(wire);
    }

    this.rebuildTriggerMap(design);
    this.refreshServices(ctx, design);
    this.lastBuilt = design;
  }

  private createUnit(ctx: AudioContext, node: NodeInstance) {
    const spec = registry[node.type];
    if (!spec) return;
    const unit = spec.createAudio(ctx, node.id);
    this.bindUnitParams(unit, node);
    this.units.set(node.id, unit);
    this.unitTypes.set(node.id, node.type);
  }

  private bindUnitParams(unit: AudioUnit, node: NodeInstance) {
    const spec = registry[node.type];
    if (!spec) return;
    for (const p of spec.params) {
      const value =
        p.sync && this.lastDesign
          ? resolveParamValue(node, p, this.lastDesign, transportService.bpm)
          : node.params[p.id] ?? p.default;
      if (!Number.isFinite(value)) {
        console.warn('[bind] non-finite value for', node.id, p.id);
      } else {
        unit.bind(p.id, value);
      }
    }
  }

  private physicalWireMap(wires: Wire[]) {
    const map = new Map<string, Wire>();
    for (const wire of wires) {
      const kind = wire.kind ?? 'audio';
      if (kind !== 'audio' && kind !== 'control') continue;
      map.set(this.wireKey(wire), wire);
    }
    return map;
  }

  private wireKey(wire: Wire) {
    return `${wire.kind ?? 'audio'}|${wire.from.nodeId}|${wire.from.pinId}|${wire.to.nodeId}|${wire.to.pinId}`;
  }

  private connectWire(wire: Wire) {
    const out = this.units.get(wire.from.nodeId)?.outputs[wire.from.pinId];
    const inp = this.units.get(wire.to.nodeId)?.inputs[wire.to.pinId];
    if (out && inp) out.connect(inp);
  }

  private disconnectWire(wire: Wire) {
    const out = this.units.get(wire.from.nodeId)?.outputs[wire.from.pinId];
    const inp = this.units.get(wire.to.nodeId)?.inputs[wire.to.pinId];
    if (!out || !inp) return;
    try {
      out.disconnect(inp);
    } catch {
      /* disconnecting an already-disconnected endpoint is harmless */
    }
  }

  private rebuildTriggerMap(design: Design) {
    this.triggerMap.clear();
    for (const wire of design.wires) {
      if (wire.kind !== 'trigger') continue;
      const handler = this.units.get(wire.to.nodeId)?.triggerIns?.[wire.to.pinId];
      if (!handler) continue;
      const key = `${wire.from.nodeId}:${wire.from.pinId}`;
      const arr = this.triggerMap.get(key) || [];
      arr.push(handler);
      this.triggerMap.set(key, arr);
    }
  }

  private refreshServices(ctx: AudioContext, design: Design) {
    const meters = new Map<string, AnalyserNode>();
    const scopes = new Map<string, AnalyserNode>();
    const eqFilters = new Map<string, BiquadFilterNode[]>();
    const eqAnalysers = new Map<string, AnalyserNode>();

    for (const [id, unit] of this.units.entries()) {
      const analysers = Object.entries(unit.analysers);
      if (analysers.length > 0) {
        meters.set(id, analysers[0][1]);
        for (const [key, analyser] of analysers) {
          meters.set(`${id}:${key}`, analyser);
        }
      }
      const first = analysers.length > 0 ? analysers[0][1] : undefined;
      if (unit.scope) scopes.set(id, unit.scope);
      if (unit.eqFilters) {
        eqFilters.set(id, unit.eqFilters);
        if (first) eqAnalysers.set(id, first);
      }
    }

    meterService.setAnalysers(meters);
    scopeService.setAnalysers(scopes);
    eqService.setFilters(eqFilters);
    eqService.setAnalysers(eqAnalysers);
    
    recorderService.prune(ctx, new Set(design.nodes.map(n => n.id)));
    looperService.prune(ctx, new Set(design.nodes.map(n => n.id)));
    midiService.prune(new Set(design.nodes.map(n => n.id)));
  }

  /** Param-path design update: keeps sync resolution fresh WITHOUT scheduling a rebuild. */
  trackDesign(design: Design) {
    this.lastDesign = design;
  }

  /** Live, smoothed, no rebuild. */
  setParam(nodeId: string, paramId: string, value: number) {
    if (!Number.isFinite(value)) {
      console.warn('[bind] non-finite value for', nodeId, paramId);
      return;
    }
    const unit = this.units.get(nodeId);
    if (!unit) return;
    const node = this.lastDesign?.nodes.find((n) => n.id === nodeId);
    const spec = node ? registry[node.type] : undefined;
    const pSpec = spec?.params.find((p) => p.id === paramId);

    // Tempo-syncable base param: the unit receives the resolved value
    if (node && pSpec?.sync && this.lastDesign) {
      const resolved = resolveParamValue(node, pSpec, this.lastDesign, transportService.bpm);
      if (Number.isFinite(resolved)) unit.bind(paramId, resolved);
      return;
    }

    unit.bind(paramId, value);

    // A division change immediately re-binds its base param's resolved value
    if (node && spec && this.lastDesign && paramId.endsWith('_div')) {
      const base = spec.params.find((p) => p.id === paramId.slice(0, -4));
      if (base?.sync) {
        const resolved = resolveParamValue(node, base, this.lastDesign, transportService.bpm);
        if (Number.isFinite(resolved)) unit.bind(base.id, resolved);
      }
    }
  }

  /** Re-bind every tempo-syncable param at its currently-resolved value
   *  (synced → BPM-derived, free → stored). Smooth bind path only — no rebuild. */
  refreshSyncedParams(design?: Design) {
    if (design) this.lastDesign = design;
    const d = this.lastDesign;
    if (!d) return;
    for (const node of d.nodes) {
      const spec = registry[node.type];
      if (!spec) continue;
      const unit = this.units.get(node.id);
      if (!unit) continue;
      for (const p of spec.params) {
        if (!p.sync) continue;
        const resolved = resolveParamValue(node, p, d, transportService.bpm);
        if (Number.isFinite(resolved)) unit.bind(p.id, resolved);
      }
    }
  }

  emitTrigger(nodeId: string, pinId: string, time?: number) {
    const handlers = this.triggerMap.get(`${nodeId}:${pinId}`);
    if (handlers) {
      for (const h of handlers) h(time);
    }
  }

  /** Decode an audio file for a Media Player node and rebuild so it plays. */
  async loadMedia(nodeId: string, file: File): Promise<string> {
    const ctx = this.ensure(); // decoding works while suspended
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    mediaCache.set(nodeId, { buffer, name: file.name });
    if (this.lastDesign) this.requestRebuild(this.lastDesign);
    return file.name;
  }
}

export const engine = new AudioEngine();
