/**
 * Wave-Lab-style visualization for Analyzer nodes: one rAF loop drawing
 * time-domain waveforms or log-frequency spectra straight to node canvases.
 * No React state on the audio path.
 */

const FPS_INTERVAL = 1000 / 30;

export type ScopeMode = 0 | 1; // 0 waveform, 1 spectrum

class ScopeService {
  private analysers = new Map<string, AnalyserNode>(); // nodeId -> analyser
  private canvases = new Map<string, HTMLCanvasElement>();
  private modes = new Map<string, ScopeMode>();
  private timeBuf = new Float32Array(2048);
  private freqBuf = new Uint8Array(1024);
  private last = 0;
  private running = false;
  private colors: {
    bg: string;
    grid: string;
    wave: string;
    spec: string;
    specTop: string;
  } | null = null;

  setAnalysers(next: Map<string, AnalyserNode>) {
    this.analysers = next;
    this.ensureRunning();
  }

  attachCanvas(nodeId: string, el: HTMLCanvasElement | null) {
    if (el) {
      this.canvases.set(nodeId, el);
      this.ensureRunning();
    } else {
      this.canvases.delete(nodeId);
    }
  }

  setMode(nodeId: string, mode: ScopeMode) {
    this.modes.set(nodeId, mode);
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
      bg: v('--canvas', '#0A0C0F'),
      grid: v('--grid-dot', '#1A1E25'),
      wave: v('--signal-1', '#2ECC71'),
      spec: v('--signal-4', '#3B9CFF'),
      specTop: v('--signal-3', '#FFC933'),
    };
  }

  private loop = (t: number) => {
    requestAnimationFrame(this.loop);
    if (t - this.last < FPS_INTERVAL) return;
    this.last = t;
    if (!this.colors) this.readColors();

    for (const [nodeId, canvas] of this.canvases) {
      const an = this.analysers.get(nodeId);
      const mode = this.modes.get(nodeId) ?? 0;
      this.draw(canvas, an, mode);
    }
  };

  private draw(
    canvas: HTMLCanvasElement,
    an: AnalyserNode | undefined,
    mode: ScopeMode,
  ) {
    const g = canvas.getContext('2d');
    if (!g || !this.colors) return;
    const w = canvas.width;
    const h = canvas.height;

    g.fillStyle = this.colors.bg;
    g.fillRect(0, 0, w, h);

    // center line / baseline
    g.strokeStyle = this.colors.grid;
    g.lineWidth = 1;
    g.beginPath();
    if (mode === 0) {
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
    } else {
      g.moveTo(0, h - 1);
      g.lineTo(w, h - 1);
    }
    g.stroke();

    if (!an) return;

    if (mode === 0) {
      // ---- waveform
      an.getFloatTimeDomainData(this.timeBuf);
      const n = an.fftSize;
      g.strokeStyle = this.colors.wave;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x < w; x++) {
        const i = Math.floor((x / w) * n);
        const y = h / 2 - this.timeBuf[i] * (h / 2 - 2);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    } else {
      // ---- spectrum, log-frequency bars
      an.getByteFrequencyData(this.freqBuf);
      const bins = an.frequencyBinCount;
      const bars = 48;
      const barW = w / bars;
      for (let b = 0; b < bars; b++) {
        // log mapping: low bars cover few bins, high bars cover many
        const f0 = Math.floor(Math.pow(bins, b / bars));
        const f1 = Math.max(f0 + 1, Math.floor(Math.pow(bins, (b + 1) / bars)));
        let peak = 0;
        for (let i = f0; i < f1 && i < bins; i++)
          if (this.freqBuf[i] > peak) peak = this.freqBuf[i];
        const v = peak / 255;
        const barH = v * (h - 3);
        g.fillStyle = v > 0.85 ? this.colors.specTop : this.colors.spec;
        g.fillRect(b * barW + 0.5, h - 1 - barH, Math.max(1, barW - 1), barH);
      }
    }
  }
}

export const scopeService = new ScopeService();
