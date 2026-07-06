export async function ensureBufferRepeaterWorklet(ctx: AudioContext): Promise<void> {
  if ((ctx as any).__plBufferRepeaterRegistered) return;
  const src = `
class PLBufferRepeater extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring0 = new Float32Array(1 << 18);
    this.ring1 = new Float32Array(1 << 18);
    this.mask = (1 << 18) - 1;
    this.wHead = 0;
    // ring index of absolute frame f = (f - baseFrame) & mask; baseFrame is captured on
    // the FIRST process() call so the clock is the AudioContext's, not this node's age —
    // a node created mid-session must still honor absolute 'when' timestamps
    this.baseFrame = -1;
    
    this.active = false;
    this.isHold = false;
    this.holdReleased = false;
    
    this.F0 = 0;
    this.sixteenthFrames = 0;
    this.gridIdx = 0;
    this.gateSixteenths = 0;
    this.gateFrames = 0;
    this.semis = 0;
    this.semisDecay = 0;
    this.gainDecay = 0;
    this.mode = 1;
    this.variation = 0;
    
    this.gridTable = [0.5, 2/3, 1, 4/3, 2, 4, 8];
    
    this.slotIdx = 0;
    this.slotStartFrame = 0;
    
    this.dryFadeState = 1;
    
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'burst' || msg.type === 'hold') {
        const { when, sixteenthFrames, gridIdx, gateSixteenths, semis, semisDecay01, gainDecay01, mode, variation, snap } = msg;
        
        let F0 = Math.round(when * sampleRate);
        const gridFrames = this.gridTable[gridIdx] * sixteenthFrames;
        
        if (snap) {
          F0 = Math.ceil(F0 / gridFrames) * gridFrames;
        }
        
        if (F0 < currentFrame) return; // stale-trigger drop: never fire off-grid
        
        this.active = true;
        this.isHold = (msg.type === 'hold');
        this.holdReleased = false;
        
        this.F0 = F0;
        this.sixteenthFrames = sixteenthFrames;
        this.gridIdx = gridIdx;
        this.gateSixteenths = gateSixteenths;
        this.gateFrames = gateSixteenths * sixteenthFrames;
        this.semis = semis;
        this.semisDecay = semisDecay01 * 12; // 100% = 12 semitones drop per repeat
        this.gainDecay = gainDecay01;
        this.mode = mode;
        this.variation = variation;
        
        this.slotIdx = 0;
        this.slotStartFrame = F0;
      }
      else if (msg.type === 'mode') {
        this.mode = msg.mode; // Gate mutes dry outside bursts — must apply immediately
      }
      else if (msg.type === 'release') {
        if (this.isHold) {
          this.holdReleased = true;
        }
      }
    };
  }
  
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    
    if (!outL) return true;

    if (this.baseFrame < 0) this.baseFrame = currentFrame;

    for (let i = 0; i < outL.length; i++) {
      const absF = currentFrame + i;
      const sL = inL ? inL[i] : 0;
      const sR = inR ? inR[i] : 0;
      
      this.ring0[this.wHead] = sL;
      this.ring1[this.wHead] = sR;
      this.wHead = (this.wHead + 1) & this.mask;
      
      let repL = 0;
      let repR = 0;
      let targetDryGain = this.mode === 2 ? 0 : 1;
      
      if (this.active && absF >= this.F0) {
        const elapsed = absF - this.F0;
        let gridFrames = this.gridTable[this.gridIdx] * this.sixteenthFrames;
        
        let endBurst = false;
        if (!this.isHold && elapsed >= this.gateFrames) {
          endBurst = true;
        } else if (absF >= this.slotStartFrame + gridFrames) {
          if (this.isHold && this.holdReleased) {
            endBurst = true;
          } else {
            this.slotIdx++;
            this.slotStartFrame += gridFrames;
            if (this.variation > 0) {
               const diff = Math.floor(Math.random() * (this.variation * 2 + 1)) - this.variation;
               this.gridIdx = Math.max(0, Math.min(this.gridTable.length - 1, this.gridIdx + diff));
               gridFrames = this.gridTable[this.gridIdx] * this.sixteenthFrames;
            }
          }
        }
        
        if (endBurst) {
          this.active = false;
        } else {
          if (this.mode === 0) targetDryGain = 1;
          else if (this.mode === 1) targetDryGain = (this.slotIdx === 0) ? 1 : 0;
          else if (this.mode === 2) targetDryGain = 0;
          
          if (this.slotIdx >= 1) {
            const k = this.slotIdx;
            const rate = Math.pow(2, (this.semis - (k - 1) * this.semisDecay) / 12);
            const slotGain = Math.pow(this.gainDecay, k - 1);
            
            const framesInSlice = absF - this.slotStartFrame;
            
            let sliceEnv = 1;
            if (framesInSlice < 256) {
              sliceEnv = 0.5 * (1 - Math.cos((framesInSlice / 256) * Math.PI));
            } else if (framesInSlice > gridFrames - 256) {
              sliceEnv = 0.5 * (1 - Math.cos(((gridFrames - framesInSlice) / 256) * Math.PI));
            }
            
            if (!this.isHold) {
              const remainingGate = this.gateFrames - elapsed;
              if (remainingGate < 256) {
                 const gateEnv = 0.5 * (1 - Math.cos((Math.max(0, remainingGate) / 256) * Math.PI));
                 sliceEnv = Math.min(sliceEnv, gateEnv);
              }
            }
            
            const readPos = this.F0 + framesInSlice * rate;
            let r0 = Math.floor(readPos);
            const frac = readPos - r0;
            r0 = (r0 - this.baseFrame) & this.mask; // absolute frame -> ring slot
            const r1 = (r0 + 1) & this.mask;
            
            const vL = this.ring0[r0] + frac * (this.ring0[r1] - this.ring0[r0]);
            const vR = this.ring1[r0] + frac * (this.ring1[r1] - this.ring1[r0]);
            
            repL = vL * slotGain * sliceEnv;
            repR = vR * slotGain * sliceEnv;
          }
        }
      }
      
      if (targetDryGain > this.dryFadeState) {
        this.dryFadeState = Math.min(1, this.dryFadeState + 1/256);
      } else if (targetDryGain < this.dryFadeState) {
        this.dryFadeState = Math.max(0, this.dryFadeState - 1/256);
      }
      const dryEnv = 0.5 * (1 - Math.cos(this.dryFadeState * Math.PI));
      
      let sumL = sL * dryEnv + repL;
      let sumR = sR * dryEnv + repR;
      
      if (this.mode === 0) {
        sumL = Math.tanh(sumL);
        sumR = Math.tanh(sumR);
      }
      
      outL[i] = sumL;
      if (outR !== outL) outR[i] = sumR;
    }
    return true;
  }
}
registerProcessor('pl-bufferrepeat', PLBufferRepeater);
`;
  const blob = new Blob([src], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  (ctx as any).__plBufferRepeaterRegistered = true;
}
