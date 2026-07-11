export async function ensureCaptureWorklet(ctx: AudioContext): Promise<void> {
  if ((ctx as any).__plCaptureRegistered) return;
  const src = `
class PLCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.armed = false;
    this.atFrame = -1;
    this.batchSize = 2048;
    this.pool = [];
    for (let i = 0; i < 8; i++) {
      this.pool[i] = [new Float32Array(this.batchSize), new Float32Array(this.batchSize)];
    }
    this.poolCount = 8;
    this.buffers = null;
    this.pos = 0;
    this.msg = { channels: null, length: 0 };
    this.transfer = [null, null];
    this.port.onmessage = (e) => {
      const data = e.data;
      if (data.recycle) {
        if (this.poolCount < this.pool.length) {
          this.pool[this.poolCount] = data.recycle;
          this.poolCount++;
        }
        if (this.armed && !this.buffers) {
          this.buffers = this.takePair();
          this.pos = 0;
        }
      }
      if (data.cmd === 'arm') {
        this.armed = true;
        this.pos = 0;
        if (!this.buffers) this.buffers = this.takePair();
      }
      if (data.cmd === 'arm_at') {
        this.atFrame = Math.round(data.when * sampleRate);
      }
      if (data.cmd === 'disarm') {
        this.armed = false;
        this.atFrame = -1;
        if (this.pos > 0 && this.buffers) {
          this.postCurrent(this.pos);
          this.buffers = this.takePair();
          this.pos = 0;
        }
      }
    };
  }
  takePair() {
    if (this.poolCount <= 0) return null;
    this.poolCount--;
    const pair = this.pool[this.poolCount];
    this.pool[this.poolCount] = null;
    return pair;
  }
  postCurrent(length) {
    const pair = this.buffers;
    if (!pair) return;
    this.msg.channels = pair;
    this.msg.length = length;
    this.transfer[0] = pair[0].buffer;
    this.transfer[1] = pair[1].buffer;
    this.port.postMessage(this.msg, this.transfer);
    this.msg.channels = null;
    this.transfer[0] = null;
    this.transfer[1] = null;
  }
  process(inputs) {
    if (!this.armed && this.atFrame < 0) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    
    const c0 = input[0];
    const c1 = input.length > 1 ? input[1] : input[0];
    if (!c0) return true;
    
    let startI = 0;
    if (!this.armed && this.atFrame >= 0) {
      const wait = this.atFrame - currentFrame;
      if (wait >= c0.length) return true;
      startI = wait > 0 ? wait : 0;
      this.armed = true;
      this.atFrame = -1;
    }
    
    let buffers = this.buffers;
    if (!buffers) {
      buffers = this.takePair();
      this.buffers = buffers;
      this.pos = 0;
      if (!buffers) return true;
    }

    for (let i = startI; i < c0.length; i++) {
      buffers[0][this.pos] = c0[i];
      buffers[1][this.pos] = c1[i];
      this.pos++;
      if (this.pos >= this.batchSize) {
        this.postCurrent(this.batchSize);
        buffers = this.takePair();
        this.buffers = buffers;
        this.pos = 0;
        if (!buffers) return true;
      }
    }
    return true;
  }
}
registerProcessor('pl-capture', PLCapture);
`;
  const blob = new Blob([src], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  (ctx as any).__plCaptureRegistered = true;
}

export class CaptureTap {
  public node: AudioWorkletNode;
  private batches: Float32Array[][] = [];
  private sampleRate: number;
  private onMsg: (e: MessageEvent) => void;

  constructor(ctx: AudioContext) {
    this.sampleRate = ctx.sampleRate;
    this.node = new AudioWorkletNode(ctx, 'pl-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
    });
    this.onMsg = (e) => {
      if (e.data && e.data.channels) {
        const channels = e.data.channels as Float32Array[];
        const length = typeof e.data.length === 'number' ? e.data.length : channels[0].length;
        const copy0 = new Float32Array(length);
        const copy1 = new Float32Array(length);
        copy0.set(channels[0].subarray(0, length));
        copy1.set(channels[1].subarray(0, length));
        this.batches.push([copy0, copy1]);
        this.node.port.postMessage({ recycle: channels }, [channels[0].buffer, channels[1].buffer]);
      }
    };
    this.node.port.onmessage = this.onMsg;
  }

  arm() {
    this.batches = [];
    this.node.port.postMessage({ cmd: 'arm' });
  }

  armAt(when: number) {
    this.batches = [];
    this.node.port.postMessage({ cmd: 'arm_at', when });
  }

  disarm() {
    this.node.port.postMessage({ cmd: 'disarm' });
    if (this.batches.length === 0) {
      return { channels: [new Float32Array(0), new Float32Array(0)], sampleRate: this.sampleRate };
    }
    
    let totalLen = 0;
    for (const b of this.batches) totalLen += b[0].length;
    
    const out0 = new Float32Array(totalLen);
    const out1 = new Float32Array(totalLen);
    
    let pos = 0;
    for (const b of this.batches) {
      out0.set(b[0], pos);
      out1.set(b[1], pos);
      pos += b[0].length;
    }
    
    this.batches = [];
    return { channels: [out0, out1], sampleRate: this.sampleRate };
  }

  dispose() {
    try {
      this.node.disconnect();
    } catch {
      /* noop */
    }
    this.node.port.close();
  }
}
