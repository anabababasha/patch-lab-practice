import { CaptureTap } from './captureWorklet';
import { encodeWav } from '../lib/wav';

type RecorderState = 'idle' | 'recording' | 'unsupported';

interface RecorderEntry {
  dest: MediaStreamAudioDestinationNode;
  tap: CaptureTap;
  recorder: MediaRecorder | null;
  state: RecorderState;
  startedAt: number;
  lastTakeSeconds: number;
  designName: string;
  chunks: Blob[];
  format: number;
}

class RecorderService {
  private cache = new WeakMap<AudioContext, Map<string, RecorderEntry>>();
  private listeners = new Map<string, Set<(state: RecorderState, startedAt: number, lastTakeSeconds: number) => void>>();
  private mimeType: string | null = null;
  onToast: ((msg: string) => void) | null = null;
  
  private getMime(): string | null {
    if (this.mimeType !== null) return this.mimeType;
    if (typeof MediaRecorder === 'undefined') return null;
    const options = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
    for (const opt of options) {
      if (MediaRecorder.isTypeSupported(opt)) {
        this.mimeType = opt;
        return opt;
      }
    }
    return '';
  }

  private ensureEntry(ctx: AudioContext, nodeId: string): RecorderEntry {
    let byCtx = this.cache.get(ctx);
    if (!byCtx) {
      byCtx = new Map();
      this.cache.set(ctx, byCtx);
    }
    let entry = byCtx.get(nodeId);
    if (!entry) {
      const dest = ctx.createMediaStreamDestination();
      const tap = new CaptureTap(ctx);
      const mime = this.getMime();
      entry = {
        dest,
        tap,
        recorder: null,
        state: 'idle', // tap always works even if mime doesn't
        startedAt: 0,
        lastTakeSeconds: 0,
        designName: 'untitled',
        chunks: [],
        format: 0,
      };
      byCtx.set(nodeId, entry);
      this.notify(nodeId, entry);
    }
    return entry;
  }

  getDest(ctx: AudioContext, nodeId: string): MediaStreamAudioDestinationNode {
    return this.ensureEntry(ctx, nodeId).dest;
  }

  getTap(ctx: AudioContext, nodeId: string): CaptureTap {
    return this.ensureEntry(ctx, nodeId).tap;
  }

  start(ctx: AudioContext, nodeId: string, designName: string, format: number = 0) {
    const byCtx = this.cache.get(ctx);
    if (!byCtx) return;
    const entry = byCtx.get(nodeId);
    if (!entry) return;

    entry.format = format;
    entry.designName = designName;

    if (format === 0) {
      // WAV via tap
      entry.tap.arm();
      entry.state = 'recording';
      entry.startedAt = Date.now();
      this.notify(nodeId, entry);
      return;
    }

    // WebM via MediaRecorder
    const mime = this.getMime();
    if (!mime) {
      entry.state = 'unsupported';
      this.notify(nodeId, entry);
      return;
    }

    try {
      if (entry.dest.stream.getAudioTracks().length === 0) {
        console.warn(`Recorder ${nodeId} started with 0 audio tracks on its destination stream.`);
      }
      
      entry.designName = designName;
      entry.chunks = [];
      entry.recorder = new MediaRecorder(entry.dest.stream, { mimeType: mime });
      
      entry.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          entry.chunks.push(e.data);
        }
      };

      entry.recorder.start(1000); // 1s timeslices
      entry.state = 'recording';
      entry.startedAt = Date.now();
      this.notify(nodeId, entry);
    } catch (err) {
      entry.state = 'unsupported';
      this.notify(nodeId, entry);
    }
  }

  stop(ctx: AudioContext, nodeId: string, pruneMessage?: string): Promise<void> {
    const byCtx = this.cache.get(ctx);
    if (!byCtx) return Promise.resolve();
    const entry = byCtx.get(nodeId);
    if (!entry || entry.state !== 'recording') return Promise.resolve();

    const downloadBlob = (blob: Blob, ext: string) => {
      const slug = entry.designName.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'patch';
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `patchlab-${slug}-${timestamp}.${ext}`;
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 100);

      if (pruneMessage && this.onToast) {
        this.onToast(pruneMessage);
      }
    };

    if (entry.format === 0) {
      // WAV via tap
      const { channels, sampleRate } = entry.tap.disarm();
      if (channels[0].length > 0) {
        const blob = encodeWav(channels, sampleRate);
        downloadBlob(blob, 'wav');
      }
      entry.lastTakeSeconds = Math.round((Date.now() - entry.startedAt) / 1000);
      entry.state = 'idle';
      this.notify(nodeId, entry);
      return Promise.resolve();
    }

    // WebM via MediaRecorder
    if (!entry.recorder) return Promise.resolve();

    return new Promise((resolve) => {
      const finalize = () => {
        if (entry.chunks.length > 0) {
          const blob = new Blob(entry.chunks, { type: this.mimeType || 'audio/webm' });
          const ext = this.mimeType?.includes('mp4') ? 'm4a' : 'webm';
          downloadBlob(blob, ext);
        }
        entry.chunks = [];
        entry.lastTakeSeconds = Math.round((Date.now() - entry.startedAt) / 1000);
        entry.state = 'idle';
        entry.recorder = null;
        this.notify(nodeId, entry);
        resolve();
      };

      let done = false;
      
      entry.recorder!.onstop = () => {
        if (done) return;
        done = true;
        finalize();
      };

      // timeout fallback in case onstop hangs
      setTimeout(() => {
        if (done) return;
        done = true;
        console.warn(`Recorder ${nodeId} timed out waiting for onstop. Finalizing with ${entry.chunks.length} chunks.`);
        finalize();
      }, 2000);

      try {
        entry.recorder!.stop();
      } catch (err) {
        if (!done) {
          done = true;
          console.warn(`Recorder ${nodeId} stop() threw`, err);
          finalize();
        }
      }
    });
  }

  prune(ctx: AudioContext, liveNodeIds: Set<string>) {
    const byCtx = this.cache.get(ctx);
    if (!byCtx) return;
    for (const [nodeId, entry] of byCtx.entries()) {
      if (!liveNodeIds.has(nodeId)) {
        if (entry.state === 'recording') {
          this.stop(ctx, nodeId, 'Recorder deleted — take saved.');
        }
        byCtx.delete(nodeId);
      }
    }
  }

  onState(nodeId: string, cb: (state: RecorderState, startedAt: number, lastTakeSeconds: number) => void) {
    let set = this.listeners.get(nodeId);
    if (!set) {
      set = new Set();
      this.listeners.set(nodeId, set);
    }
    set.add(cb);
    return () => set?.delete(cb);
  }

  private notify(nodeId: string, entry: RecorderEntry) {
    const set = this.listeners.get(nodeId);
    if (set) {
      for (const cb of set) {
        cb(entry.state, entry.startedAt, entry.lastTakeSeconds);
      }
    }
  }
}

export const recorderService = new RecorderService();
