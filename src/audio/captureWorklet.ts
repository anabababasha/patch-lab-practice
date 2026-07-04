export async function ensureCaptureWorklet(ctx: AudioContext): Promise<void> {
  if ((ctx as any).__plCaptureRegistered) return;
  const src = `
class PLCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.armed = false;
    this.port.onmessage = (e) => {
      if (e.data.cmd === 'arm') this.armed = true;
      if (e.data.cmd === 'disarm') {
        this.armed = false;
        // flush remaining
        if (this.pos > 0) {
          const out0 = new Float32Array(this.buffers[0].buffer, 0, this.pos);
          const out1 = new Float32Array(this.buffers[1].buffer, 0, this.pos);
          this.port.postMessage({ channels: [out0, out1] }, [out0.buffer, out1.buffer]);
          this.buffers = [new Float32Array(this.batchSize), new Float32Array(this.batchSize)];
          this.pos = 0;
        }
      }
    };
    this.batchSize = 2048;
    this.buffers = [new Float32Array(this.batchSize), new Float32Array(this.batchSize)];
    this.pos = 0;
  }
  process(inputs) {
    if (!this.armed) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    
    const c0 = input[0];
    const c1 = input.length > 1 ? input[1] : input[0];
    if (!c0) return true;

    for (let i = 0; i < c0.length; i++) {
      this.buffers[0][this.pos] = c0[i];
      this.buffers[1][this.pos] = c1[i];
      this.pos++;
      if (this.pos >= this.batchSize) {
        const out0 = this.buffers[0];
        const out1 = this.buffers[1];
        this.port.postMessage({ channels: [out0, out1] }, [out0.buffer, out1.buffer]);
        this.buffers = [new Float32Array(this.batchSize), new Float32Array(this.batchSize)];
        this.pos = 0;
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
        this.batches.push(e.data.channels);
      }
    };
    this.node.port.onmessage = this.onMsg;
  }

  arm() {
    this.batches = [];
    this.node.port.postMessage({ cmd: 'arm' });
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
    this.node.disconnect();
    this.node.port.close();
  }
}
