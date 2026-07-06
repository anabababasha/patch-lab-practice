import { gainToDb } from '../lib/units';

interface Level {
  rmsDb: number;
  peakHoldDb: number;
  holdUntil: number;
  clipUntil: number;
}

const FLOOR = -60;
const CLIP_AT = -0.5; // dBFS
const HOLD_MS = 1000;
const FPS_INTERVAL = 1000 / 30;

/**
 * One global rAF loop. Analysers are read and meters drawn straight to each
 * node's <canvas> via refs — no React state anywhere on the audio path.
 */
class MeterService {
  private analysers = new Map<string, AnalyserNode>(); // lookupKey -> analyser
  private canvases = new Map<string, { el: HTMLCanvasElement; lookup: string }>();
  private levels = new Map<string, Level>();
  private buf = new Float32Array(512);
  private last = 0;
  private running = false;
  private colors: {
    track: string;
    rms: string;
    peak: string;
    clip: string;
  } | null = null;

  setAnalysers(next: Map<string, AnalyserNode>) {
    this.analysers = next;
    for (const id of this.levels.keys())
      if (!next.has(id)) this.levels.delete(id);
    this.ensureRunning();
  }

  attachCanvas(nodeId: string, el: HTMLCanvasElement | null, slot = 'node', analyserKey?: string) {
    const canvasKey = `${nodeId}|${slot}`;
    if (el) {
      const lookup = analyserKey ? `${nodeId}:${analyserKey}` : nodeId;
      this.canvases.set(canvasKey, { el, lookup });
      this.ensureRunning();
    } else {
      this.canvases.delete(canvasKey);
    }
  }

  private ensureRunning() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    this.colors = {
      track: v('--surface', '#12151A'),
      rms: v('--meter-rms', '#2ECC71'),
      peak: v('--meter-peak', '#FFC933'),
      clip: v('--meter-clip', '#FF4D4D'),
    };
  }

  private loop = (t: number) => {
    requestAnimationFrame(this.loop);
    if (t - this.last < FPS_INTERVAL) return;
    this.last = t;
    if (!this.colors) this.readColors();

    for (const [canvasKey, { el: canvas, lookup }] of this.canvases) {
      const an = this.analysers.get(lookup);
      let level = this.levels.get(lookup);
      if (!level) {
        level = { rmsDb: FLOOR, peakHoldDb: FLOOR, holdUntil: 0, clipUntil: 0 };
        this.levels.set(lookup, level);
      }

      if (an) {
        an.getFloatTimeDomainData(this.buf);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < this.buf.length; i++) {
          const s = this.buf[i];
          sum += s * s;
          const a = Math.abs(s);
          if (a > peak) peak = a;
        }
        const rmsDb = gainToDb(Math.sqrt(sum / this.buf.length), FLOOR);
        const peakDb = gainToDb(peak, FLOOR);
        level.rmsDb = rmsDb;
        if (peakDb >= level.peakHoldDb || t >= level.holdUntil) {
          level.peakHoldDb = peakDb;
          level.holdUntil = t + HOLD_MS;
        }
        if (peakDb >= CLIP_AT) level.clipUntil = t + HOLD_MS;
      } else {
        level.rmsDb = FLOOR;
        level.peakHoldDb = FLOOR;
      }

      this.draw(canvas, level, t);
    }
  };

  private draw(canvas: HTMLCanvasElement, level: Level, now: number) {
    const g = canvas.getContext('2d');
    if (!g || !this.colors) return;
    const w = canvas.width;
    const h = canvas.height;
    const norm = (db: number) => Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR));

    g.clearRect(0, 0, w, h);
    g.fillStyle = this.colors.track;
    g.fillRect(0, 0, w, h);

    // RMS bar
    g.fillStyle = this.colors.rms;
    g.fillRect(0, 0, Math.round(norm(level.rmsDb) * w), h);

    // peak-hold tick
    const px = Math.round(norm(level.peakHoldDb) * w);
    if (px > 2) {
      g.fillStyle = this.colors.peak;
      g.fillRect(Math.min(px, w - 2), 0, 2, h);
    }

    // clip latch — rightmost segment
    if (now < level.clipUntil) {
      g.fillStyle = this.colors.clip;
      g.fillRect(w - 4, 0, 4, h);
    }
  }
}

export const meterService = new MeterService();
