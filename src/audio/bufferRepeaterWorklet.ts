export async function ensureBufferRepeaterWorklet(ctx: AudioContext): Promise<void> {
  if ((ctx as any).__plBufferRepeaterRegistered) return;
  const src = `
class PLBufferRepeater extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring0 = new Float32Array(1 << 18);
    this.ring1 = new Float32Array(1 << 18);
    this.mask = (1 << 18) - 1;
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
    this.satMix = 0;
    
    this.pF0 = -1;
    this.pSix = 0;
    this.pGrid = 0;
    this.pGate = 0;
    this.pSemis = 0;
    this.pSemisDecay = 0;
    this.pGainDecay = 0;
    this.pMode = 1;
    this.pVar = 0;
    this.pIsHold = false;
    this.killFade = 1;
    
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
        
        if (this.active && this.slotIdx >= 1) {
          this.pF0 = F0;
          this.pSix = sixteenthFrames;
          this.pGrid = gridIdx;
          this.pGate = gateSixteenths;
          this.pSemis = semis;
          this.pSemisDecay = semisDecay01;
          this.pGainDecay = gainDecay01;
          this.pMode = mode;
          this.pVar = variation;
          this.pIsHold = (msg.type === 'hold');
        } else {
          this.pF0 = -1; // a stale pending burst must never stomp this newer one at its old F0
          this.killFade = 1; // safe: nothing wet is sounding on the direct-apply path
          this.applyBurst(F0, sixteenthFrames, gridIdx, gateSixteenths, semis, semisDecay01, gainDecay01, mode, variation, msg.type === 'hold');
        }
      }
      else if (msg.type === 'mode') {
        this.mode = msg.mode; // Gate mutes dry outside bursts — must apply immediately
      }
      else if (msg.type === 'release') {
        if (this.pF0 >= 0 && this.pIsHold) this.pF0 = -1; // quick tap: cancel a hold that hasn't started yet
        if (this.isHold) {
          this.holdReleased = true;
        }
      }
    };
  }

  applyBurst(F0, sixteenthFrames, gridIdx, gateSixteenths, semis, semisDecay01, gainDecay01, mode, variation, isHold) {
    this.active = true;
    this.isHold = isHold;
    this.holdReleased = false;
    
    this.F0 = F0;
    this.sixteenthFrames = sixteenthFrames;
    this.gridIdx = gridIdx;
    this.gateSixteenths = gateSixteenths;
    this.gateFrames = Math.min(gateSixteenths * sixteenthFrames, Math.max(0, this.mask - 8 * sixteenthFrames));
    this.semis = semis;
    this.semisDecay = semisDecay01 * 12; // 100% = 12 semitones drop per repeat
    this.gainDecay = gainDecay01;
    this.mode = mode;
    this.variation = variation;
    
    this.slotIdx = 0;
    this.slotStartFrame = F0;
  }
  
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    
    if (this.baseFrame < 0) this.baseFrame = currentFrame;
    
    if (!outL) return true;

    for (let i = 0; i < outL.length; i++) {
      const absF = currentFrame + i;
      const sL = inL ? inL[i] : 0;
      const sR = inR ? inR[i] : 0;
      
      const ringIdx = (absF - this.baseFrame) & this.mask;
      this.ring0[ringIdx] = sL;
      this.ring1[ringIdx] = sR;
      
      let repL = 0;
      let repR = 0;
      let targetDryGain = this.mode === 2 ? 0 : 1;
      
      if (this.pF0 >= 0) {
        this.killFade = Math.max(0, this.killFade - 1 / 256);
        if (absF >= this.pF0) {
          this.applyBurst(this.pF0, this.pSix, this.pGrid, this.pGate, this.pSemis, this.pSemisDecay, this.pGainDecay, this.pMode, this.pVar, this.pIsHold);
          this.pF0 = -1;
          this.killFade = 1;
        }
      }
      
      if (this.active && absF >= this.F0) {
        const elapsed = absF - this.F0;
        let gridFrames = this.gridTable[this.gridIdx] * this.sixteenthFrames;
        if (this.isHold && !this.holdReleased && (absF - this.F0) > (this.mask - 8 * this.sixteenthFrames)) {
          this.holdReleased = true;
        }
        
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
            }
            const rem = gridFrames - framesInSlice;
            if (rem < 256) {
              const fo = 0.5 * (1 - Math.cos((rem / 256) * Math.PI));
              if (fo < sliceEnv) sliceEnv = fo;
            }
            
            if (!this.isHold) {
              const remainingGate = this.gateFrames - elapsed;
              if (remainingGate < 256) {
                 const gateEnv = 0.5 * (1 - Math.cos((Math.max(0, remainingGate) / 256) * Math.PI));
                 sliceEnv = Math.min(sliceEnv, gateEnv);
              }
            }
            
            let readPos = this.F0 + framesInSlice * rate;
            if (readPos > absF) readPos = absF;
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
      
      if (this.killFade < 1) {
        const killEnv = 0.5 * (1 - Math.cos(this.killFade * Math.PI));
        repL *= killEnv;
        repR *= killEnv;
      }
      
      if (targetDryGain > this.dryFadeState) {
        this.dryFadeState = Math.min(1, this.dryFadeState + 1/256);
      } else if (targetDryGain < this.dryFadeState) {
        this.dryFadeState = Math.max(0, this.dryFadeState - 1/256);
      }
      const dryEnv = 0.5 * (1 - Math.cos(this.dryFadeState * Math.PI));
      
      let sumL = sL * dryEnv + repL;
      let sumR = sR * dryEnv + repR;
      
      const satT = this.mode === 0 ? 1 : 0;
      if (satT > this.satMix) this.satMix = Math.min(1, this.satMix + 1 / 256);
      else if (satT < this.satMix) this.satMix = Math.max(0, this.satMix - 1 / 256);
      if (this.satMix > 0) {
        sumL += this.satMix * (Math.tanh(sumL) - sumL);
        sumR += this.satMix * (Math.tanh(sumR) - sumR);
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
