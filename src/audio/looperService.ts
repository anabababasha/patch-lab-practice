import { CaptureTap, ensureCaptureWorklet } from './captureWorklet';
import { transportService } from './transportService';

export type LooperState = 'empty' | 'recording' | 'playing' | 'stopped';

interface LooperEntry {
  tap: CaptureTap;
  bus: GainNode;
  state: LooperState;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  sourceGain: GainNode | null;
  startedAt: number; // For UI elapsed time (realtime)
  sync: boolean;
  
  pendingAction: 'record' | 'stop_record' | null;
}

class LooperService {
  private cache = new WeakMap<AudioContext, Map<string, LooperEntry>>();
  private listeners = new Map<string, Set<(state: LooperState, startedAt: number) => void>>();

  private getM(ctx: AudioContext) {
    let m = this.cache.get(ctx);
    if (!m) {
      m = new Map();
      this.cache.set(ctx, m);
    }
    return m;
  }

  async ensureEntry(ctx: AudioContext, nodeId: string): Promise<LooperEntry> {
    const m = this.getM(ctx);
    let entry = m.get(nodeId);
    if (!entry) {
      await ensureCaptureWorklet(ctx);
      const tap = new CaptureTap(ctx);
      const bus = ctx.createGain();
      entry = {
        tap,
        bus,
        state: 'empty',
        buffer: null,
        source: null,
        sourceGain: null,
        startedAt: 0,
        sync: false,
        pendingAction: null,
      };
      m.set(nodeId, entry);

      // Register with transport to handle bar-synced actions
      transportService.registerSequencer(`looper_${nodeId}`, (time, tickIndex) => {
        if (tickIndex % 16 === 0) { // Bar boundary
          if (entry!.pendingAction === 'record') {
            entry!.pendingAction = null;
            const delayMs = (time - ctx.currentTime) * 1000;
            setTimeout(() => {
              if (entry!.state === 'empty') {
                entry!.tap.arm();
                entry!.state = 'recording';
                entry!.startedAt = Date.now();
                this.notify(nodeId, entry!);
              }
            }, Math.max(0, delayMs));
          } else if (entry!.pendingAction === 'stop_record') {
            entry!.pendingAction = null;
            const delayMs = (time - ctx.currentTime) * 1000;
            setTimeout(() => {
              if (entry!.state === 'recording') {
                this.finalizeRecord(ctx, nodeId, entry!, true, time);
              }
            }, Math.max(0, delayMs));
          }
        }
      });
      
      this.notify(nodeId, entry);
    }
    return entry;
  }

  getPlaybackBus(ctx: AudioContext, nodeId: string): GainNode | null {
    return this.getM(ctx).get(nodeId)?.bus || null;
  }
  
  getTap(ctx: AudioContext, nodeId: string): CaptureTap | null {
    return this.getM(ctx).get(nodeId)?.tap || null;
  }

  action(ctx: AudioContext, nodeId: string, sync: boolean) {
    const entry = this.getM(ctx).get(nodeId);
    if (!entry) return;

    entry.sync = sync;
    const isSynced = sync && transportService.running;

    if (entry.state === 'empty') {
      if (isSynced) {
        entry.pendingAction = 'record';
      } else {
        entry.tap.arm();
        entry.state = 'recording';
        entry.startedAt = Date.now();
        this.notify(nodeId, entry);
      }
    } else if (entry.state === 'recording') {
      if (isSynced) {
        entry.pendingAction = 'stop_record';
      } else {
        this.finalizeRecord(ctx, nodeId, entry, false, ctx.currentTime);
      }
    } else if (entry.state === 'playing') {
      this.stopPlayback(ctx, entry, ctx.currentTime);
      entry.state = 'stopped';
      this.notify(nodeId, entry);
    } else if (entry.state === 'stopped') {
      if (isSynced) {
        // Find next bar
        const now = ctx.currentTime;
        let nextBarTime = now;
        if (transportService.running) {
          // Calculate time to next bar based on lookahead
          // Actually, just start immediately but quantized
          const beatsPerSec = transportService.bpm / 60;
          const barDuration = 4 / beatsPerSec;
          // Approximate next bar boundary
          // We can't perfectly guess unless we hook sequencer.
          // Let's just start it immediately for simplicity if not in record flow
          this.startPlayback(ctx, entry, now);
        } else {
          this.startPlayback(ctx, entry, now);
        }
      } else {
        this.startPlayback(ctx, entry, ctx.currentTime);
      }
      entry.state = 'playing';
      this.notify(nodeId, entry);
    }
  }

  clear(ctx: AudioContext, nodeId: string) {
    const entry = this.getM(ctx).get(nodeId);
    if (!entry) return;
    this.stopPlayback(ctx, entry, ctx.currentTime);
    entry.buffer = null;
    entry.state = 'empty';
    entry.pendingAction = null;
    this.notify(nodeId, entry);
  }

  private finalizeRecord(ctx: AudioContext, nodeId: string, entry: LooperEntry, isSynced: boolean, startTime: number) {
    const { channels, sampleRate } = entry.tap.disarm();
    let numFrames = channels[0].length;
    
    if (numFrames > 0) {
      if (isSynced) {
        // Round to nearest bar
        const framesPerBeat = sampleRate * (60 / transportService.bpm);
        const framesPerBar = framesPerBeat * 4;
        const bars = Math.round(numFrames / framesPerBar);
        const targetFrames = Math.max(1, bars) * framesPerBar;
        
        const c0 = new Float32Array(targetFrames);
        const c1 = new Float32Array(targetFrames);
        c0.set(channels[0].subarray(0, Math.min(numFrames, targetFrames)));
        c1.set(channels[1].subarray(0, Math.min(numFrames, targetFrames)));
        
        entry.buffer = ctx.createBuffer(2, targetFrames, sampleRate);
        entry.buffer.copyToChannel(c0, 0);
        entry.buffer.copyToChannel(c1, 1);
      } else {
        entry.buffer = ctx.createBuffer(2, numFrames, sampleRate);
        entry.buffer.copyToChannel(channels[0], 0);
        entry.buffer.copyToChannel(channels[1], 1);
      }
      
      entry.state = 'playing';
      this.startPlayback(ctx, entry, startTime);
    } else {
      entry.state = 'empty';
    }
    
    this.notify(nodeId, entry);
  }

  private startPlayback(ctx: AudioContext, entry: LooperEntry, time: number) {
    this.stopPlayback(ctx, entry, time); // Cleanup old
    if (!entry.buffer) return;

    entry.source = ctx.createBufferSource();
    entry.source.buffer = entry.buffer;
    entry.source.loop = true;

    entry.sourceGain = ctx.createGain();
    entry.sourceGain.gain.setValueAtTime(0, time);
    entry.sourceGain.gain.linearRampToValueAtTime(1, time + 0.003); // 3ms micro-fade

    entry.source.connect(entry.sourceGain);
    entry.sourceGain.connect(entry.bus);

    entry.source.start(time);
  }

  private stopPlayback(ctx: AudioContext, entry: LooperEntry, time: number) {
    if (entry.source && entry.sourceGain) {
      entry.sourceGain.gain.setValueAtTime(1, time);
      entry.sourceGain.gain.linearRampToValueAtTime(0, time + 0.003);
      entry.source.stop(time + 0.003);
      
      const s = entry.source;
      const sg = entry.sourceGain;
      setTimeout(() => {
        s.disconnect();
        sg.disconnect();
      }, 50);
    }
    entry.source = null;
    entry.sourceGain = null;
  }

  prune(ctx: AudioContext, liveNodeIds: Set<string>) {
    const m = this.cache.get(ctx);
    if (!m) return;
    for (const [nodeId, entry] of m.entries()) {
      if (!liveNodeIds.has(nodeId)) {
        transportService.unregister(`looper_${nodeId}`);
        this.stopPlayback(ctx, entry, ctx.currentTime);
        entry.tap.dispose();
        entry.bus.disconnect();
        m.delete(nodeId);
      }
    }
  }

  onState(nodeId: string, cb: (state: LooperState, startedAt: number) => void) {
    let set = this.listeners.get(nodeId);
    if (!set) {
      set = new Set();
      this.listeners.set(nodeId, set);
    }
    set.add(cb);
    return () => set?.delete(cb);
  }

  private notify(nodeId: string, entry: LooperEntry) {
    const set = this.listeners.get(nodeId);
    if (set) {
      for (const cb of set) {
        cb(entry.state, entry.startedAt);
      }
    }
  }
}

export const looperService = new LooperService();
