import { CaptureTap, ensureCaptureWorklet } from './captureWorklet';
import { transportService } from './transportService';

export type LooperState = 'empty' | 'recording' | 'playing' | 'stopped';

type PendingAction = 'record' | 'stop_record' | 'reverse' | null;

interface LooperEntry {
  ctx: AudioContext;
  tap: CaptureTap;
  bus: GainNode;
  state: LooperState;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  sourceGain: GainNode | null;
  startedAt: number; // realtime, for UI elapsed time
  sourceStartTime: number; // AudioContext time, for waveform playhead
  sync: boolean;
  speed: number;
  regionStart: number;
  regionEnd: number;
  bufferVersion: number;
  pendingAction: PendingAction;
}

interface PeakCache {
  bufferVersion: number;
  width: number;
  peaks: Float32Array;
}

interface LoopColors {
  bg: string;
  grid: string;
  wave: string;
  handle: string;
  playhead: string;
  shade: string;
}

const FPS_INTERVAL = 1000 / 30;
const MIN_REGION_SECONDS = 0.05;
const ZERO_SNAP_SECONDS = 0.01;
const TARGET_DBFS = Math.pow(10, -1 / 20);

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

class LooperService {
  private cache = new WeakMap<AudioContext, Map<string, LooperEntry>>();
  private entries = new Map<string, LooperEntry>();
  private listeners = new Map<
    string,
    Set<(state: LooperState, startedAt: number, hasLoop: boolean, bufferVersion: number) => void>
  >();
  private canvases = new Map<string, HTMLCanvasElement>();
  private peakCache = new Map<string, PeakCache>();
  private desiredSpeed = new Map<string, number>();
  private desiredSync = new Map<string, boolean>();
  private lastFrame = 0;
  private running = false;
  private colors: LoopColors | null = null;

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
        ctx,
        tap,
        bus,
        state: 'empty',
        buffer: null,
        source: null,
        sourceGain: null,
        startedAt: 0,
        sourceStartTime: 0,
        sync: this.desiredSync.get(nodeId) ?? false,
        speed: this.desiredSpeed.get(nodeId) ?? 1,
        regionStart: 0,
        regionEnd: 0,
        bufferVersion: 0,
        pendingAction: null,
      };
      m.set(nodeId, entry);
      this.entries.set(nodeId, entry);

      transportService.registerSequencer(`looper_${nodeId}`, (time, tickIndex) => {
        if (tickIndex % 16 !== 0) return;
        const pending = entry!.pendingAction;
        if (!pending) return;
        entry!.pendingAction = null;
        const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
        window.setTimeout(() => {
          if (pending === 'record' && entry!.state === 'empty') {
            entry!.tap.arm();
            entry!.state = 'recording';
            entry!.startedAt = Date.now();
            this.notify(nodeId, entry!);
          } else if (pending === 'stop_record' && entry!.state === 'recording') {
            this.finalizeRecord(ctx, nodeId, entry!, true, time);
          } else if (pending === 'reverse' && entry!.buffer) {
            this.applyReverse(ctx, nodeId, entry!, entry!.state === 'playing', time);
          }
        }, delayMs);
      });

      this.notify(nodeId, entry);
    } else {
      entry.ctx = ctx;
      this.entries.set(nodeId, entry);
    }
    return entry;
  }

  getPlaybackBus(ctx: AudioContext, nodeId: string): GainNode | null {
    return this.getM(ctx).get(nodeId)?.bus || null;
  }

  getTap(ctx: AudioContext, nodeId: string): CaptureTap | null {
    return this.getM(ctx).get(nodeId)?.tap || null;
  }

  getRegion(nodeId: string): { start: number; end: number; duration: number } | null {
    const entry = this.entries.get(nodeId);
    if (!entry?.buffer) return null;
    return {
      start: entry.regionStart,
      end: entry.regionEnd,
      duration: entry.buffer.duration,
    };
  }

  setSync(nodeId: string, sync: boolean) {
    this.desiredSync.set(nodeId, sync);
    const entry = this.entries.get(nodeId);
    if (entry) entry.sync = sync;
  }

  setSpeed(nodeId: string, rate: number) {
    const speed = clamp(rate, 0.25, 4);
    this.desiredSpeed.set(nodeId, speed);
    const entry = this.entries.get(nodeId);
    if (!entry) return;
    const time = entry.ctx.currentTime;
    const offset = entry.source ? this.getPlaybackOffset(entry, time) : entry.regionStart;
    entry.speed = speed;
    if (entry.source) {
      entry.source.playbackRate.cancelScheduledValues(time);
      entry.source.playbackRate.setValueAtTime(speed, time);
      this.setPlaybackAnchor(entry, offset, time);
    }
  }

  setRegion(nodeId: string, startS: number, endS: number) {
    const entry = this.entries.get(nodeId);
    if (!entry?.buffer) return;

    const duration = entry.buffer.duration;
    const wasPlaying = !!entry.source;
    const playbackOffset = wasPlaying
      ? this.getPlaybackOffset(entry, entry.ctx.currentTime)
      : entry.regionStart;
    let start = clamp(startS, 0, Math.max(0, duration - MIN_REGION_SECONDS));
    let end = clamp(endS, MIN_REGION_SECONDS, duration);
    const movingStart =
      Math.abs(start - entry.regionStart) >= Math.abs(end - entry.regionEnd);

    if (entry.sync && transportService.running) {
      const grid = 60 / transportService.bpm / 4;
      start = clamp(Math.round(start / grid) * grid, 0, duration);
      end = clamp(Math.round(end / grid) * grid, 0, duration);
    }

    if (end - start < MIN_REGION_SECONDS) {
      if (movingStart) start = end - MIN_REGION_SECONDS;
      else end = start + MIN_REGION_SECONDS;
    }

    start = clamp(start, 0, Math.max(0, duration - MIN_REGION_SECONDS));
    end = clamp(end, MIN_REGION_SECONDS, duration);

    start = this.snapToZeroCrossing(entry.buffer, start);
    end = this.snapToZeroCrossing(entry.buffer, end);

    if (end - start < MIN_REGION_SECONDS) {
      if (movingStart) start = clamp(end - MIN_REGION_SECONDS, 0, duration - MIN_REGION_SECONDS);
      else end = clamp(start + MIN_REGION_SECONDS, MIN_REGION_SECONDS, duration);
    }

    entry.regionStart = clamp(start, 0, duration);
    entry.regionEnd = clamp(end, entry.regionStart + MIN_REGION_SECONDS, duration);
    this.applySourceRegion(entry);
    if (wasPlaying) this.setPlaybackAnchor(entry, playbackOffset, entry.ctx.currentTime);
  }

  normalize(nodeId: string) {
    const entry = this.entries.get(nodeId);
    if (!entry?.buffer) return;

    const peak = this.measurePeak(entry.buffer);
    if (peak === 0) return;
    const wasPlaying = entry.state === 'playing';
    const restartOffset = wasPlaying
      ? this.getPlaybackOffset(entry, entry.ctx.currentTime)
      : entry.regionStart;

    const scale = TARGET_DBFS / peak;
    for (let ch = 0; ch < entry.buffer.numberOfChannels; ch++) {
      const data = entry.buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = clamp(data[i] * scale, -1, 1);
    }

    entry.bufferVersion++;
    if (wasPlaying) this.startPlayback(entry.ctx, entry, entry.ctx.currentTime, restartOffset);
    this.notify(nodeId, entry);
  }

  reattachPlayback(ctx: AudioContext, nodeId: string) {
    const entry = this.getM(ctx).get(nodeId);
    if (!entry?.buffer || entry.state !== 'playing' || !entry.source) return;
    // The source never actually stopped during rebuild, it just played into a disconnected bus.
    // Reconnecting the bus (done by LooperUnit) is sufficient; restarting the source causes a glitch
    // and clobbers phase alignment.
  }

  reverse(nodeId: string) {
    const entry = this.entries.get(nodeId);
    if (!entry?.buffer) return;

    if (entry.sync && transportService.running && entry.state === 'playing') {
      entry.pendingAction = 'reverse';
      return;
    }

    this.applyReverse(entry.ctx, nodeId, entry, entry.state === 'playing', entry.ctx.currentTime);
  }

  attachLoopCanvas(nodeId: string, el: HTMLCanvasElement | null) {
    if (el) {
      this.canvases.set(nodeId, el);
      this.ensureDrawing();
    } else {
      this.canvases.delete(nodeId);
    }
  }

  action(ctx: AudioContext, nodeId: string, sync: boolean) {
    const entry = this.getM(ctx).get(nodeId);
    if (!entry) return;

    entry.sync = sync;
    this.desiredSync.set(nodeId, sync);
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
      this.startPlayback(ctx, entry, ctx.currentTime);
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
    entry.regionStart = 0;
    entry.regionEnd = 0;
    entry.sourceStartTime = 0;
    entry.bufferVersion++;
    this.peakCache.delete(nodeId);
    this.notify(nodeId, entry);
  }

  prune(ctx: AudioContext, liveNodeIds: Set<string>) {
    const m = this.cache.get(ctx);
    if (!m) return;
    for (const [nodeId, entry] of m.entries()) {
      if (!liveNodeIds.has(nodeId)) {
        transportService.unregister(`looper_${nodeId}`);
        this.stopPlayback(ctx, entry, ctx.currentTime);
        entry.tap.dispose();
        try { entry.bus.disconnect(); } catch {}
        m.delete(nodeId);
        this.entries.delete(nodeId);
        this.canvases.delete(nodeId);
        this.peakCache.delete(nodeId);
      }
    }
  }

  onState(
    nodeId: string,
    cb: (state: LooperState, startedAt: number, hasLoop: boolean, bufferVersion: number) => void,
  ) {
    let set = this.listeners.get(nodeId);
    if (!set) {
      set = new Set();
      this.listeners.set(nodeId, set);
    }
    set.add(cb);
    const entry = this.entries.get(nodeId);
    if (entry) cb(entry.state, entry.startedAt, !!entry.buffer, entry.bufferVersion);
    return () => set?.delete(cb);
  }

  private finalizeRecord(
    ctx: AudioContext,
    nodeId: string,
    entry: LooperEntry,
    isSynced: boolean,
    startTime: number,
  ) {
    const { channels, sampleRate } = entry.tap.disarm();
    const numFrames = channels[0].length;

    if (numFrames > 0) {
      if (isSynced) {
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

      entry.regionStart = 0;
      entry.regionEnd = entry.buffer.duration;
      entry.bufferVersion++;
      entry.state = 'playing';
      this.startPlayback(ctx, entry, startTime);
    } else {
      entry.buffer = null;
      entry.regionStart = 0;
      entry.regionEnd = 0;
      entry.state = 'empty';
    }

    this.notify(nodeId, entry);
  }

  private startPlayback(
    ctx: AudioContext,
    entry: LooperEntry,
    time: number,
    offset = entry.regionStart,
  ) {
    const t = Math.max(time, ctx.currentTime);
    this.stopPlayback(ctx, entry, t);
    if (!entry.buffer) return;

    const duration = entry.buffer.duration;
    if (entry.regionEnd <= entry.regionStart) {
      entry.regionStart = 0;
      entry.regionEnd = duration;
    }

    entry.source = ctx.createBufferSource();
    entry.source.buffer = entry.buffer;
    entry.source.loop = true;
    entry.source.loopStart = entry.regionStart;
    entry.source.loopEnd = entry.regionEnd;
    entry.source.playbackRate.setValueAtTime(entry.speed, t);

    entry.sourceGain = ctx.createGain();
    entry.sourceGain.gain.setValueAtTime(0, t);
    entry.sourceGain.gain.linearRampToValueAtTime(1, t + 0.003);

    entry.source.connect(entry.sourceGain);
    entry.sourceGain.connect(entry.bus);
    const startOffset =
      offset >= entry.regionStart && offset < entry.regionEnd
        ? offset
        : entry.regionStart;
    entry.source.start(t, startOffset);
    this.setPlaybackAnchor(entry, startOffset, t);
  }

  private stopPlayback(ctx: AudioContext, entry: LooperEntry, time: number) {
    const t = Math.max(time, ctx.currentTime);
    if (entry.source && entry.sourceGain) {
      try {
        entry.sourceGain.gain.setValueAtTime(1, t);
        entry.sourceGain.gain.linearRampToValueAtTime(0, t + 0.003);
        entry.source.stop(t + 0.003);
      } catch {
        /* noop */
      }

      const s = entry.source;
      const sg = entry.sourceGain;
      window.setTimeout(() => {
        try { s.disconnect(); } catch {}
        try { sg.disconnect(); } catch {}
      }, 50);
    }
    entry.source = null;
    entry.sourceGain = null;
  }

  private applyReverse(
    ctx: AudioContext,
    nodeId: string,
    entry: LooperEntry,
    restart: boolean,
    time: number,
  ) {
    if (!entry.buffer) return;

    for (let ch = 0; ch < entry.buffer.numberOfChannels; ch++) {
      entry.buffer.getChannelData(ch).reverse();
    }

    const duration = entry.buffer.duration;
    const oldStart = entry.regionStart;
    const oldEnd = entry.regionEnd;
    entry.regionStart = clamp(duration - oldEnd, 0, duration);
    entry.regionEnd = clamp(duration - oldStart, entry.regionStart + MIN_REGION_SECONDS, duration);
    entry.bufferVersion++;

    if (restart) this.startPlayback(ctx, entry, time);
    else this.applySourceRegion(entry);

    this.notify(nodeId, entry);
  }

  private applySourceRegion(entry: LooperEntry) {
    if (!entry.source) return;
    entry.source.loopStart = entry.regionStart;
    entry.source.loopEnd = entry.regionEnd;
  }

  private getPlaybackOffset(entry: LooperEntry, time: number) {
    if (!entry.buffer || entry.regionEnd <= entry.regionStart) return entry.regionStart;
    const regionLength = entry.regionEnd - entry.regionStart;
    const elapsed = Math.max(0, time - entry.sourceStartTime) * entry.speed;
    return entry.regionStart + (elapsed % regionLength);
  }

  private setPlaybackAnchor(entry: LooperEntry, offset: number, time: number) {
    const maxOffset = Math.max(entry.regionStart, entry.regionEnd - Number.EPSILON);
    const safeOffset = clamp(offset, entry.regionStart, maxOffset);
    entry.sourceStartTime =
      time - (safeOffset - entry.regionStart) / Math.max(0.0001, entry.speed);
  }

  private measurePeak(buffer: AudioBuffer) {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    return peak;
  }

  private snapToZeroCrossing(buffer: AudioBuffer, seconds: number) {
    if (buffer.length <= 1) return seconds;
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const target = clamp(Math.round(seconds * sampleRate), 0, buffer.length - 1);
    const radius = Math.max(1, Math.round(ZERO_SNAP_SECONDS * sampleRate));

    let bestIndex = target;
    let bestDistance = Infinity;
    const scanMin = Math.max(1, target - radius);
    const scanMax = Math.min(buffer.length - 1, target + radius);

    for (let i = scanMin; i <= scanMax; i++) {
      const a = data[i - 1];
      const b = data[i];
      const crosses = a === 0 || b === 0 || (a < 0 && b > 0) || (a > 0 && b < 0);
      if (!crosses) continue;
      const dist = Math.abs(i - target);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = i;
      }
    }

    return bestDistance === Infinity ? seconds : bestIndex / sampleRate;
  }

  private notify(nodeId: string, entry: LooperEntry) {
    const set = this.listeners.get(nodeId);
    if (set) {
      for (const cb of set) {
        cb(entry.state, entry.startedAt, !!entry.buffer, entry.bufferVersion);
      }
    }
  }

  private ensureDrawing() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.drawLoop);
  }

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    this.colors = {
      bg: v('--canvas', '#0A0C0F'),
      grid: v('--grid-dot', '#1A1E25'),
      wave: v('--text-secondary', '#8A919C'),
      handle: v('--text-secondary', '#8A919C'),
      playhead: v('--signal-1', '#2ECC71'),
      shade: 'rgba(10, 12, 15, 0.70)',
    };
  }

  private drawLoop = (t: number) => {
    if (this.canvases.size === 0) {
      this.running = false;
      return;
    }

    requestAnimationFrame(this.drawLoop);
    if (t - this.lastFrame < FPS_INTERVAL) return;
    this.lastFrame = t;
    if (!this.colors) this.readColors();

    for (const [nodeId, canvas] of this.canvases) {
      this.drawCanvas(nodeId, canvas);
    }
  };

  private drawCanvas(nodeId: string, canvas: HTMLCanvasElement) {
    const entry = this.entries.get(nodeId);
    const g = canvas.getContext('2d');
    if (!g || !this.colors || !entry?.buffer) {
      canvas.style.display = 'none';
      return;
    }

    canvas.style.display = 'block';
    this.ensureCanvasSize(canvas);

    const w = canvas.width;
    const h = canvas.height;
    const peaks = this.getPeaks(nodeId, entry, w);
    const duration = entry.buffer.duration;
    const regionStartX = (entry.regionStart / duration) * w;
    const regionEndX = (entry.regionEnd / duration) * w;

    g.clearRect(0, 0, w, h);
    g.fillStyle = this.colors.bg;
    g.fillRect(0, 0, w, h);

    g.strokeStyle = this.colors.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();

    g.strokeStyle = this.colors.wave;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x < w; x++) {
      const min = peaks[x * 2];
      const max = peaks[x * 2 + 1];
      const y1 = h / 2 - max * (h / 2 - 4);
      const y2 = h / 2 - min * (h / 2 - 4);
      g.moveTo(x + 0.5, y1);
      g.lineTo(x + 0.5, y2);
    }
    g.stroke();

    g.fillStyle = this.colors.shade;
    if (regionStartX > 0) g.fillRect(0, 0, regionStartX, h);
    if (regionEndX < w) g.fillRect(regionEndX, 0, w - regionEndX, h);

    g.strokeStyle = this.colors.handle;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(regionStartX, 0);
    g.lineTo(regionStartX, h);
    g.moveTo(regionEndX, 0);
    g.lineTo(regionEndX, h);
    g.stroke();

    if (entry.state === 'playing' && entry.source && entry.regionEnd > entry.regionStart) {
      const regionLength = entry.regionEnd - entry.regionStart;
      const elapsed = Math.max(0, entry.ctx.currentTime - entry.sourceStartTime) * entry.speed;
      const playheadS = (elapsed % regionLength) + entry.regionStart;
      const x = (playheadS / duration) * w;
      g.strokeStyle = this.colors.playhead;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
  }

  private ensureCanvasSize(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * 2));
    const h = Math.max(1, Math.round(rect.height * 2));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  private getPeaks(nodeId: string, entry: LooperEntry, width: number) {
    const cache = this.peakCache.get(nodeId);
    if (cache && cache.bufferVersion === entry.bufferVersion && cache.width === width) {
      return cache.peaks;
    }

    const buffer = entry.buffer!;
    const data = buffer.getChannelData(0);
    const peaks = new Float32Array(width * 2);
    for (let x = 0; x < width; x++) {
      const start = Math.floor((x / width) * data.length);
      const end = Math.max(start + 1, Math.floor(((x + 1) / width) * data.length));
      let min = 1;
      let max = -1;
      for (let i = start; i < end && i < data.length; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[x * 2] = min;
      peaks[x * 2 + 1] = max;
    }

    this.peakCache.set(nodeId, {
      bufferVersion: entry.bufferVersion,
      width,
      peaks,
    });
    return peaks;
  }
}

export const looperService = new LooperService();
