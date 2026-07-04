type EqBand = {
  id: string;
  freq: number;
  gain: number;
};

type EqBandParams = {
  bands: EqBand[];
  activeBandId?: string | null;
};

type EqPathCache = {
  width: number;
  height: number;
  path: Path2D;
};

type EqColors = {
  bg: string;
  grid: string;
  curve: string;
  spectrum: string;
  handle: string;
  active: string;
};

const FPS_INTERVAL = 1000 / 30;
const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const DB_MIN = -18;
const DB_MAX = 18;
const POINTS = 200;

const freqToNorm = (freq: number) =>
  Math.log(freq / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN);

const normToFreq = (norm: number) =>
  FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, norm);

const dbToY = (db: number, height: number) =>
  ((DB_MAX - Math.max(DB_MIN, Math.min(DB_MAX, db))) / (DB_MAX - DB_MIN)) * height;

class EqService {
  private filters = new Map<string, BiquadFilterNode[]>();
  private analysers = new Map<string, AnalyserNode>();
  private canvases = new Map<string, HTMLCanvasElement>();
  private bandParams = new Map<string, EqBandParams>();
  private dirty = new Set<string>();
  private pathCache = new Map<string, EqPathCache>();
  private freqs = new Float32Array(POINTS);
  private mag = new Float32Array(POINTS);
  private phase = new Float32Array(POINTS);
  private combinedMag = new Float32Array(POINTS);
  private freqBuf = new Uint8Array(1024);
  private last = 0;
  private running = false;
  private colors: EqColors | null = null;

  constructor() {
    for (let i = 0; i < POINTS; i++) {
      this.freqs[i] = normToFreq(i / (POINTS - 1));
    }
  }

  setFilters(next: Map<string, BiquadFilterNode[]>) {
    this.filters = next;
    this.pathCache.clear();
    for (const nodeId of next.keys()) this.dirty.add(nodeId);
    this.ensureRunning();
  }

  setAnalysers(next: Map<string, AnalyserNode>) {
    this.analysers = next;
    this.ensureRunning();
  }

  attachCanvas(nodeId: string, el: HTMLCanvasElement | null) {
    if (el) {
      this.canvases.set(nodeId, el);
      this.dirty.add(nodeId);
      this.ensureRunning();
    } else {
      this.canvases.delete(nodeId);
    }
  }

  markDirty(nodeId: string) {
    this.dirty.add(nodeId);
    this.ensureRunning();
  }

  setBandParams(nodeId: string, params: EqBandParams) {
    this.bandParams.set(nodeId, params);
    this.ensureRunning();
  }

  private ensureRunning() {
    if (this.running || this.canvases.size === 0) return;
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    const signal = v('--signal-4', '#3B9CFF');
    this.colors = {
      bg: v('--canvas', '#0A0C0F'),
      grid: v('--grid-dot', '#1A1E25'),
      curve: v('--text-primary', '#E8EAED'),
      spectrum: `color-mix(in srgb, ${signal} 25%, transparent)`,
      handle: v('--text-secondary', '#8A919C'),
      active: v('--border-active', '#9AA3AF'),
    };
  }

  private loop = (t: number) => {
    if (this.canvases.size === 0) {
      this.running = false;
      return;
    }

    requestAnimationFrame(this.loop);
    if (t - this.last < FPS_INTERVAL) return;
    this.last = t;
    if (!this.colors) this.readColors();

    for (const [nodeId, canvas] of this.canvases) {
      this.draw(nodeId, canvas);
    }
  };

  private draw(nodeId: string, canvas: HTMLCanvasElement) {
    const g = canvas.getContext('2d');
    if (!g || !this.colors) return;
    this.ensureCanvasSize(nodeId, canvas);

    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = this.colors.bg;
    g.fillRect(0, 0, w, h);

    this.drawSpectrum(g, nodeId, w, h);
    this.drawZeroLine(g, w, h);
    this.drawResponse(g, nodeId, w, h);
    this.drawBands(g, nodeId, w, h);
  }

  private ensureCanvasSize(nodeId: string, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * 2));
    const h = Math.max(1, Math.round(rect.height * 2));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      this.dirty.add(nodeId);
    }
  }

  private drawSpectrum(
    g: CanvasRenderingContext2D,
    nodeId: string,
    width: number,
    height: number,
  ) {
    const analyser = this.analysers.get(nodeId);
    if (!analyser || !this.colors) return;

    if (this.freqBuf.length !== analyser.frequencyBinCount) {
      this.freqBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(this.freqBuf);

    const nyquist = analyser.context.sampleRate / 2;
    g.fillStyle = this.colors.spectrum;
    g.beginPath();
    g.moveTo(0, height);
    for (let x = 0; x <= width; x++) {
      const freq = normToFreq(x / width);
      const bin = Math.min(
        this.freqBuf.length - 1,
        Math.max(0, Math.round((freq / nyquist) * this.freqBuf.length)),
      );
      const v = this.freqBuf[bin] / 255;
      const y = height - v * (height - 4);
      g.lineTo(x, y);
    }
    g.lineTo(width, height);
    g.closePath();
    g.fill();
  }

  private drawZeroLine(g: CanvasRenderingContext2D, width: number, height: number) {
    if (!this.colors) return;
    const y = dbToY(0, height);
    g.strokeStyle = this.colors.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(width, y);
    g.stroke();
  }

  private drawResponse(
    g: CanvasRenderingContext2D,
    nodeId: string,
    width: number,
    height: number,
  ) {
    const filters = this.filters.get(nodeId);
    if (!filters || filters.length === 0 || !this.colors) return;

    const cached = this.pathCache.get(nodeId);
    let path = cached?.path;
    if (!path || !cached || cached.width !== width || cached.height !== height || this.dirty.has(nodeId)) {
      path = this.buildResponsePath(filters, width, height);
      this.pathCache.set(nodeId, { width, height, path });
      this.dirty.delete(nodeId);
    }

    g.strokeStyle = this.colors.curve;
    g.lineWidth = 3;
    g.stroke(path);
  }

  private buildResponsePath(
    filters: BiquadFilterNode[],
    width: number,
    height: number,
  ) {
    this.combinedMag.fill(1);
    for (const filter of filters) {
      filter.getFrequencyResponse(this.freqs, this.mag, this.phase);
      for (let i = 0; i < POINTS; i++) {
        this.combinedMag[i] *= this.mag[i];
      }
    }

    const path = new Path2D();
    for (let i = 0; i < POINTS; i++) {
      const x = (i / (POINTS - 1)) * width;
      const db = 20 * Math.log10(Math.max(0.000001, this.combinedMag[i]));
      const y = dbToY(db, height);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    return path;
  }

  private drawBands(
    g: CanvasRenderingContext2D,
    nodeId: string,
    width: number,
    height: number,
  ) {
    const params = this.bandParams.get(nodeId);
    if (!params || params.bands.length === 0 || !this.colors) return;

    for (const band of params.bands) {
      const x = freqToNorm(band.freq) * width;
      const y = dbToY(band.gain, height);
      const active = params.activeBandId === band.id;
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.fillStyle = active ? this.colors.active : this.colors.bg;
      g.fill();
      g.strokeStyle = this.colors.handle;
      g.lineWidth = 2;
      g.stroke();
    }
  }
}

export const eqService = new EqService();
