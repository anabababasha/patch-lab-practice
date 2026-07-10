export async function ensureGrainWorklet(ctx: AudioContext): Promise<void> {
  if ((ctx as any).__plGrainRegistered) return;
  const src = `
class PLGrainDelay extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring0 = new Float32Array(1 << 18);
    this.ring1 = new Float32Array(1 << 18);
    this.mask = (1 << 18) - 1;
    this.wHead = 0;
    this.absHead = 0;
    
    // params
    this.p_time = 250;
    this.p_size = 100;
    this.p_density = 2;
    this.p_pitch = 0;
    this.p_rndPitch = 0;
    this.p_spray = 20;
    this.p_spread = 50;
    
    // smoothed
    this.p_feedback = 0.35;
    this.f_feedback = 0.35;
    this.t_comp = 1 / Math.sqrt(2);
    this.f_comp = this.t_comp;
    
    this.p_freeze = 0;
    this.f_writeGain = 1;
    
    // smoothing coeff: sample-rate-invariant ~5ms time constant
    this.alpha = 1 - Math.exp(-1 / (0.005 * sampleRate));
    
    this.port.onmessage = (e) => {
      const { id, value } = e.data;
      if (!Number.isFinite(value)) return;
      if (id === 'time') this.p_time = value;
      else if (id === 'size') this.p_size = value;
      else if (id === 'density') {
        this.p_density = value;
        this.t_comp = 1 / Math.sqrt(Math.max(1, value));
      }
      else if (id === 'pitch') this.p_pitch = value;
      else if (id === 'rndPitch') this.p_rndPitch = value;
      else if (id === 'spray') this.p_spray = value;
      else if (id === 'spread') this.p_spread = value;
      else if (id === 'feedback') this.p_feedback = value / 100;
      else if (id === 'freeze') this.p_freeze = value;
    };
    
    // Hann LUT
    this.hann = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / 4096));
    }
    
    // grains
    this.maxGrains = 32;
    this.g_active = new Int32Array(this.maxGrains); // 0 or 1
    this.g_pos = new Float32Array(this.maxGrains); // phase (0 to durationFrames)
    this.g_read = new Float64Array(this.maxGrains); // start position (absolute frames; f64 — f32 quantizes to whole frames after ~12min uptime)
    this.g_rate = new Float32Array(this.maxGrains); // step size
    this.g_dur = new Float32Array(this.maxGrains); // durationFrames
    this.g_win = new Float32Array(this.maxGrains); // spawn window for freeze wraps
    this.g_panL = new Float32Array(this.maxGrains);
    this.g_panR = new Float32Array(this.maxGrains);
    
    this.nextSpawnTimer = 0;
  }
  
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    
    if (!outL) return true;
    
    const sr = sampleRate;
    
    for (let i = 0; i < outL.length; i++) {
      // param smoothing
      this.f_feedback += this.alpha * (this.p_feedback - this.f_feedback);
      this.f_comp += this.alpha * (this.t_comp - this.f_comp);
      const targetWriteGain = this.p_freeze > 0.5 ? 0 : 1;
      this.f_writeGain += this.alpha * (targetWriteGain - this.f_writeGain);
      const headStep = targetWriteGain > 0.5 ? 1 : 0;
      
      // spawn logic
      if (this.nextSpawnTimer <= 0) {
        let gIdx = -1;
        for (let j = 0; j < this.maxGrains; j++) {
          if (this.g_active[j] === 0) {
            gIdx = j;
            break;
          }
        }
        
        if (gIdx !== -1) {
          const timeFrames = (this.p_time / 1000) * sr;
          const sprayFrames = (this.p_spray / 1000) * sr;
          const sprayPick = Math.random() * sprayFrames;
          const readStart = this.absHead - timeFrames - sprayPick;
          
          const pitchCt = this.p_pitch * 100 + (Math.random() * 2 - 1) * this.p_rndPitch;
          const rate = Math.pow(2, pitchCt / 1200);
          
          const spreadNorm = this.p_spread / 100;
          const rPan = (Math.random() * 2 - 1) * spreadNorm;
          const angle = (rPan + 1) * Math.PI / 4;
          
          this.g_active[gIdx] = 1;
          this.g_pos[gIdx] = 0;
          this.g_read[gIdx] = readStart;
          this.g_rate[gIdx] = rate;
          this.g_dur[gIdx] = (this.p_size / 1000) * sr;
          this.g_win[gIdx] = timeFrames + sprayPick;
          this.g_panL[gIdx] = Math.cos(angle);
          this.g_panR[gIdx] = Math.sin(angle);
        }
        
        const density = Math.max(0.25, this.p_density);
        const intervalMs = this.p_size / density;
        this.nextSpawnTimer += (intervalMs / 1000) * sr;
      }
      this.nextSpawnTimer--;
      
      // sum grains
      let sumL = 0;
      let sumR = 0;
      
      for (let j = 0; j < this.maxGrains; j++) {
        if (this.g_active[j] === 0) continue;
        
        let pos = this.g_pos[j];
        const dur = this.g_dur[j];
        if (pos >= dur) {
          this.g_active[j] = 0;
          continue;
        }
        
        const envPhase = pos / dur;
        let lutIdx = Math.floor(envPhase * 4096);
        if (lutIdx > 4095) lutIdx = 4095;
        const env = this.hann[lutIdx];
        
        let readPos = this.g_read[j] + pos * this.g_rate[j];
        const dist = this.absHead - readPos;
        const closing = this.g_rate[j] - headStep;
        const guard = closing > 0 ? 2 + closing : 2;
        if (dist <= guard) {
          if (headStep === 0) {
            this.g_read[j] -= this.g_win[j];
            readPos = this.g_read[j] + pos * this.g_rate[j];
          } else {
            readPos = this.absHead - 2;
            this.g_read[j] = readPos - pos * this.g_rate[j];
          }
        }
        let r0 = Math.floor(readPos);
        const frac = readPos - r0;
        
        r0 = r0 & this.mask;
        const r1 = (r0 + 1) & this.mask;
        
        const sL = this.ring0[r0] + frac * (this.ring0[r1] - this.ring0[r0]);
        const sR = this.ring1[r0] + frac * (this.ring1[r1] - this.ring1[r0]);
        
        const grainL = sL * env;
        const grainR = sR * env;
        
        sumL += grainL * this.g_panL[j];
        sumR += grainR * this.g_panR[j];
        
        this.g_pos[j] = pos + 1;
      }
      
      // overlap compensation (density grains overlap) + soft-clip bounds the wet bus
      const comp = this.f_comp;
      const wetL = Math.tanh(sumL * comp);
      const wetR = Math.tanh(sumR * comp);

      outL[i] = wetL;
      if (outR !== outL) outR[i] = wetR;

      // write to ring — when frozen, the write head STOPS with the writes so the
      // grain read-window pins to the frozen material instead of sliding into stale ring
      if (this.f_writeGain > 0.001) {
        const sampL = inL ? inL[i] : 0;
        const sampR = inR ? inR[i] : 0;

        const newL = Math.tanh(sampL + this.f_feedback * wetL);
        const newR = Math.tanh(sampR + this.f_feedback * wetR);

        this.ring0[this.wHead] = this.ring0[this.wHead] * (1 - this.f_writeGain) + newL * this.f_writeGain;
        this.ring1[this.wHead] = this.ring1[this.wHead] * (1 - this.f_writeGain) + newR * this.f_writeGain;

        if (headStep > 0) {
          this.wHead = (this.wHead + 1) & this.mask;
          this.absHead++;
        }
      }
    }
    
    return true;
  }
}
registerProcessor('pl-graindelay', PLGrainDelay);
`;
  const blob = new Blob([src], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  (ctx as any).__plGrainRegistered = true;
}
