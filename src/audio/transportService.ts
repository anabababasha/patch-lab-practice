export const transportService = new (class {
  bpm = 100;
  running = false;
  nextTickTime = 0;
  tickIndex = 0;
  ctx: AudioContext | null = null;
  intervalId: number | null = null;
  lookaheadSec = 0.12;
  tickScheduleMs = 25;
  
  subscribers = new Map<string, (time: number, tickIndex: number) => void>();
  uiSubscribers = new Set<(tickIndex: number, delayMs: number) => void>();
  stopSubscribers = new Set<() => void>();

  attach(ctx: AudioContext) {
    this.ctx = ctx;
  }

  setBpm(v: number) {
    this.bpm = Math.max(40, Math.min(240, v));
  }

  start() {
    if (!this.ctx || this.running) return;
    this.running = true;
    this.tickIndex = 0;
    this.nextTickTime = this.ctx.currentTime + 0.06;
    this.schedule();
  }

  stop() {
    this.running = false;
    this.tickIndex = 0;
    if (this.ctx) this.nextTickTime = this.ctx.currentTime + 0.06;
    if (this.intervalId !== null) {
      window.clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    for (const cb of this.stopSubscribers) cb();
  }

  getGlobalTick() {
    return this.tickIndex;
  }

  getBarBeat(tickIndex = this.tickIndex) {
    const beatTicks = 4;
    const barTicks = beatTicks * 4;
    const bar = Math.floor(tickIndex / barTicks) + 1;
    const beat = Math.floor((tickIndex % barTicks) / beatTicks) + 1;
    const sixteenth = (tickIndex % beatTicks) + 1;
    return { bar, beat, sixteenth };
  }

  registerSequencer(nodeId: string, cb: (time: number, tickIndex: number) => void) {
    this.subscribers.set(nodeId, cb);
  }

  unregister(nodeId: string) {
    this.subscribers.delete(nodeId);
  }

  onUiTick(cb: (tickIndex: number, delayMs: number) => void) {
    this.uiSubscribers.add(cb);
  }
  
  offUiTick(cb: (tickIndex: number, delayMs: number) => void) {
    this.uiSubscribers.delete(cb);
  }

  onTransportStop(cb: () => void) {
    this.stopSubscribers.add(cb);
  }

  offTransportStop(cb: () => void) {
    this.stopSubscribers.delete(cb);
  }

  private schedule = () => {
    if (!this.running || !this.ctx) return;
    while (this.nextTickTime < this.ctx.currentTime + this.lookaheadSec) {
      const time = this.nextTickTime;
      const idx = this.tickIndex;
      
      for (const cb of this.subscribers.values()) {
        cb(time, idx);
      }
      
      const delayMs = Math.max(0, (time - this.ctx.currentTime) * 1000);
      for (const uiCb of this.uiSubscribers) {
        uiCb(idx, delayMs);
      }
      
      const tickDuration = 60 / this.bpm / 4;
      this.nextTickTime += tickDuration;
      this.tickIndex++;
    }
    this.intervalId = window.setTimeout(this.schedule, this.tickScheduleMs);
  };
})();
