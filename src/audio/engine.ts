import type { AudioUnit, Design } from '../lib/types';
import { registry } from '../components/registry';
import { meterService } from './meterService';
import { scopeService } from './scopeService';
import { mediaCache } from './mediaCache';

/**
 * Compile strategy: correctness over cleverness.
 *  - structural change  -> debounced 50 ms full teardown + rebuild
 *  - param change       -> bind() only (setTargetAtTime, zero rebuilds)
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private units = new Map<string, AudioUnit>();
  private timer: number | undefined;
  private lastDesign: Design | null = null;
  onStateChange: ((running: boolean) => void) | null = null;

  get context() {
    return this.ctx;
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.ctx.addEventListener('statechange', () => {
        this.onStateChange?.(this.ctx?.state === 'running');
      });
    }
    return this.ctx;
  }

  /** User-gesture gate: builds the current design, then resumes. */
  async start(design: Design): Promise<boolean> {
    const ctx = this.ensure();
    this.lastDesign = design;
    this.rebuild(design);
    await ctx.resume();
    return ctx.state === 'running';
  }

  async suspend(): Promise<void> {
    await this.ctx?.suspend();
  }

  /** Call on any node/wire add/remove (or full design swap). */
  requestRebuild(design: Design) {
    this.lastDesign = design;
    if (!this.ctx) return; // nothing audible yet; start() will build fresh
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.lastDesign) this.rebuild(this.lastDesign);
    }, 50);
  }

  private rebuild(design: Design) {
    const ctx = this.ctx;
    if (!ctx) return;

    for (const u of this.units.values()) {
      try {
        u.dispose();
      } catch (e) {
        /* bare .disconnect() on an unwired node throws in some browsers; ignore */
      }
    }
    this.units.clear();

    const meters = new Map<string, AnalyserNode>();
    const scopes = new Map<string, AnalyserNode>();

    for (const n of design.nodes) {
      const spec = registry[n.type];
      if (!spec) continue;
      const unit = spec.createAudio(ctx, n.id);
      for (const p of spec.params) unit.bind(p.id, n.params[p.id] ?? p.default);
      this.units.set(n.id, unit);
      const first = Object.values(unit.analysers)[0];
      if (first) meters.set(n.id, first);
      if (unit.scope) scopes.set(n.id, unit.scope);
    }

    for (const w of design.wires) {
      const out = this.units.get(w.from.nodeId)?.outputs[w.from.pinId];
      const inp = this.units.get(w.to.nodeId)?.inputs[w.to.pinId];
      if (out && inp) out.connect(inp);
    }

    meterService.setAnalysers(meters);
    scopeService.setAnalysers(scopes);
  }

  /** Live, smoothed, no rebuild. */
  setParam(nodeId: string, paramId: string, value: number) {
    this.units.get(nodeId)?.bind(paramId, value);
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
