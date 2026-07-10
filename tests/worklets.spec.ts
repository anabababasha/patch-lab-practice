import { test, expect } from '@playwright/test';

const DETECT_SRC = String.raw`
function detectClicks(data, sr, startSec, endSec, thr) {
  thr = thr === undefined ? 0.05 : thr;
  const start = Math.max(1, Math.floor(startSec * sr));
  const end = Math.min(data.length, Math.floor(endSec * sr));
  let maxJump = 0, maxJumpAt = -1, count = 0, lastHit = -1e9;
  const hits = [];
  for (let i = start; i < end; i++) {
    const d = Math.abs(data[i] - data[i - 1]);
    if (d > maxJump) { maxJump = d; maxJumpAt = i; }
    if (d > thr) {
      if (i - lastHit > 32) { count++; if (hits.length < 8) hits.push({ atSec: i / sr, delta: d }); }
      lastHit = i;
    }
  }
  return { maxJump, maxJumpAtSec: maxJumpAt / sr, count, hits };
}
function rmsDbFile(data, sr, startSec, endSec) {
  const start = Math.floor(startSec * sr);
  const end = Math.min(data.length, Math.floor(endSec * sr));
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return 10 * Math.log10(Math.sqrt(sum / Math.max(1, end - start)) + 1e-12);
}
`;

test.describe('Grain Delay DSP Worklet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__plWorkletTest !== undefined,
    );
  });

  test('Non-silence & Basic Operation', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { ensureGrainWorklet, createGrainDelay } = (window as unknown as {
        __plWorkletTest: {
          ensureGrainWorklet: (ctx: BaseAudioContext) => Promise<void>;
          createGrainDelay: (ctx: BaseAudioContext, id: string) => {
            inputs: Record<string, AudioNode>;
            outputs: Record<string, AudioNode>;
            bind: (id: string, v: number) => void;
          };
        };
      }).__plWorkletTest;
      
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 1, sr);
      await ensureGrainWorklet(ctx);
      
      const gd = createGrainDelay(ctx, 'gd1');
      gd.bind('mix', 100);
      gd.bind('time', 250);
      gd.bind('size', 100);
      gd.bind('density', 2);
      gd.bind('feedback', 0);
      
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      
      const env = ctx.createGain();
      env.gain.value = 1;
      env.gain.setValueAtTime(1, 0.1);
      env.gain.linearRampToValueAtTime(0, 0.11);
      
      osc.connect(env);
      env.connect(gd.inputs.in);
      gd.outputs.out.connect(ctx.destination);
      osc.start();
      
      const buffer = await ctx.startRendering();
      const dataL = buffer.getChannelData(0);
      
      let hasNaN = false;
      let hasInf = false;
      let sumL = 0;
      let count = 0;
      const startIdx = Math.floor(0.25 * sr);
      for (let i = startIdx; i < dataL.length; i++) {
        if (Number.isNaN(dataL[i])) hasNaN = true;
        if (!Number.isFinite(dataL[i])) hasInf = true;
        sumL += dataL[i] * dataL[i];
        count++;
      }
      const rmsDb = 10 * Math.log10(Math.sqrt(sumL / count) + 1e-12);
      
      return { hasNaN, hasInf, rmsDb };
    });
    
    expect(result.hasNaN).toBe(false);
    expect(result.hasInf).toBe(false);
    expect(result.rmsDb).toBeGreaterThan(-60);
  });

  test('Freeze holds while control decays', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { ensureGrainWorklet, createGrainDelay } = (window as unknown as {
        __plWorkletTest: {
          ensureGrainWorklet: (ctx: BaseAudioContext) => Promise<void>;
          createGrainDelay: (ctx: BaseAudioContext, id: string) => {
            inputs: Record<string, AudioNode>;
            outputs: Record<string, AudioNode>;
            bind: (id: string, v: number) => void;
          };
        };
      }).__plWorkletTest;
      
      const sr = 48000;
      const renderTest = async (frozen: boolean) => {
        const ctx = new OfflineAudioContext(2, sr * 3, sr);
        await ensureGrainWorklet(ctx);
        const gd = createGrainDelay(ctx, 'gd1');
        gd.bind('mix', 100);
        gd.bind('time', 100);
        gd.bind('feedback', 0);
        
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        // tone sounds until 1.0s — freeze fires at 0.45s, so even if the port message
        // lands a few hundred ms late (delivery to the audio thread is async), the
        // frozen read-window still contains TONE, not silence
        env.gain.value = 1;
        env.gain.setValueAtTime(1, 1.0);
        env.gain.linearRampToValueAtTime(0, 1.01);

        osc.connect(env);
        env.connect(gd.inputs.in);
        gd.outputs.out.connect(ctx.destination);
        osc.start();

        if (frozen) {
          ctx.suspend(0.45).then(async () => {
            gd.bind('freeze', 1);
            // let the message queue drain to the (idle, suspended) audio thread
            await new Promise((r) => setTimeout(r, 25));
            ctx.resume();
          });
        }
        
        const buffer = await ctx.startRendering();
        const dataL = buffer.getChannelData(0);
        let sumL = 0;
        let count = 0;
        const startIdx = Math.floor(2.0 * sr);
        for (let i = startIdx; i < dataL.length; i++) {
          sumL += dataL[i] * dataL[i];
          count++;
        }
        return 10 * Math.log10(Math.sqrt(sumL / count) + 1e-12);
      };
      
      const rmsFrozen = await renderTest(true);
      const rmsControl = await renderTest(false);
      return { rmsFrozen, rmsControl };
    });
    
    expect(result.rmsFrozen).toBeGreaterThan(-60);
    expect(result.rmsControl).toBeLessThan(-60);
  });

  test('Bypass transparency', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { ensureGrainWorklet, createGrainDelay } = (window as unknown as {
        __plWorkletTest: {
          ensureGrainWorklet: (ctx: BaseAudioContext) => Promise<void>;
          createGrainDelay: (ctx: BaseAudioContext, id: string) => {
            inputs: Record<string, AudioNode>;
            outputs: Record<string, AudioNode>;
            bind: (id: string, v: number) => void;
          };
        };
      }).__plWorkletTest;
      
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 0.5, sr);
      await ensureGrainWorklet(ctx);
      const gd = createGrainDelay(ctx, 'gd1');
      gd.bind('mix', 100);
      gd.bind('time', 100);
      
      ctx.suspend(0.1).then(() => {
        gd.bind('bypass', 1);
        ctx.resume();
      });
      
      const osc = ctx.createOscillator();
      osc.connect(gd.inputs.in);
      
      const pureDry = ctx.createGain();
      osc.connect(pureDry);
      
      const merger = ctx.createChannelMerger(2);
      gd.outputs.out.connect(merger, 0, 0);
      pureDry.connect(merger, 0, 1);
      merger.connect(ctx.destination);
      
      osc.start();
      
      const buffer = await ctx.startRendering();
      const outGD = buffer.getChannelData(0);
      const outDry = buffer.getChannelData(1);
      
      let maxDiff = 0;
      for (let i = Math.floor(0.2 * sr); i < outGD.length; i++) {
        const diff = Math.abs(outGD[i] - outDry[i]);
        if (diff > maxDiff) maxDiff = diff;
      }
      return maxDiff;
    });
    
    expect(result).toBeLessThan(0.01);
  });

  test('Feedback stability', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { ensureGrainWorklet, createGrainDelay } = (window as unknown as {
        __plWorkletTest: {
          ensureGrainWorklet: (ctx: BaseAudioContext) => Promise<void>;
          createGrainDelay: (ctx: BaseAudioContext, id: string) => {
            inputs: Record<string, AudioNode>;
            outputs: Record<string, AudioNode>;
            bind: (id: string, v: number) => void;
          };
        };
      }).__plWorkletTest;
      
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 3, sr);
      await ensureGrainWorklet(ctx);
      const gd = createGrainDelay(ctx, 'gd1');
      gd.bind('mix', 100);
      gd.bind('time', 50);
      gd.bind('size', 100);
      gd.bind('density', 8);
      gd.bind('feedback', 100);
      gd.bind('pitch', 12);
      
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      env.gain.value = 1;
      env.gain.setValueAtTime(1, 0.1);
      env.gain.linearRampToValueAtTime(0, 0.11);
      osc.connect(env);
      env.connect(gd.inputs.in);
      gd.outputs.out.connect(ctx.destination);
      osc.start();
      
      const buffer = await ctx.startRendering();
      const dataL = buffer.getChannelData(0);
      
      let maxAbs = 0;
      let hasNaN = false;
      for (let i = 0; i < dataL.length; i++) {
        if (Number.isNaN(dataL[i])) hasNaN = true;
        const abs = Math.abs(dataL[i]);
        if (abs > maxAbs) maxAbs = abs;
      }
      return { maxAbs, hasNaN };
    });
    
    expect(result.hasNaN).toBe(false);
    expect(result.maxAbs).toBeLessThanOrEqual(1.05);
  });
});

test.describe('Buffer Repeater DSP Worklet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__plWorkletTest !== undefined,
    );
  });

  test('Identity', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { ensureBufferRepeaterWorklet, createBufferRepeater } = (window as unknown as any).__plWorkletTest;
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 1, sr);
      await ensureBufferRepeaterWorklet(ctx);
      const br = createBufferRepeater(ctx, 'br1');
      br.bind('chance', 0);
      
      const osc = ctx.createOscillator();
      const am = ctx.createGain();
      const mod = ctx.createOscillator();
      mod.frequency.value = 10;
      mod.connect(am.gain);
      osc.connect(am);
      am.connect(br.inputs.in);
      
      const pureDry = ctx.createGain();
      am.connect(pureDry);
      
      const merger = ctx.createChannelMerger(2);
      br.outputs.out.connect(merger, 0, 0);
      pureDry.connect(merger, 0, 1);
      merger.connect(ctx.destination);
      
      osc.start();
      mod.start();
      
      const buffer = await ctx.startRendering();
      const outBR = buffer.getChannelData(0);
      const outDry = buffer.getChannelData(1);
      
      let maxDiff = 0;
      for (let i = 0; i < outBR.length; i++) {
        const diff = Math.abs(outBR[i] - outDry[i]);
        if (diff > maxDiff) maxDiff = diff;
      }
      return maxDiff;
    });
    
    expect(result).toBeLessThan(0.01);
  });

  test('Burst repeats', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { ensureBufferRepeaterWorklet, createBufferRepeater } = (window as unknown as any).__plWorkletTest;
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 1, sr);
      await ensureBufferRepeaterWorklet(ctx);
      const br = createBufferRepeater(ctx, 'br1');
      br.bind('mode', 1); // Insert
      
      br.bind('gate', 3); // 3 sixteenths @ default 100 BPM = 0.45s burst

      // transport singleton defaults to 100 BPM -> sixteenth = 0.15s = grid (idx 2).
      // trig at 0.45s lies exactly ON a grid boundary (3 * 0.15), so snap keeps F0 = 0.45s.
      // Slot layout: capture [0.45,0.60) | rep1 [0.60,0.75) | rep2 [0.75,0.90) | live after 0.90.
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(440, 0);
      osc.frequency.setValueAtTime(880, 0.62); // step INSIDE rep1 — repeats must replay 440, live is 880

      osc.connect(br.inputs.in);
      br.outputs.out.connect(ctx.destination);
      osc.start();

      // suspend guarantees port-message delivery before the render outruns the queue
      ctx.suspend(0.1).then(() => {
        br.triggerIns!.trig!(0.45);
        ctx.resume();
      });

      const buffer = await ctx.startRendering();
      const dataL = buffer.getChannelData(0);

      const getZeroCrossings = (startSec: number, endSec: number) => {
        const start = Math.floor(startSec * sr);
        const end = Math.floor(endSec * sr);
        let zc = 0;
        for (let i = start + 1; i < end; i++) {
          if (dataL[i-1] < 0 && dataL[i] >= 0) zc++;
        }
        return zc;
      };

      const zcCapture = getZeroCrossings(0.45, 0.6);   // 440 Hz x 0.15s ~ 66
      const zcRep1 = getZeroCrossings(0.6, 0.75);      // replay of capture ~ 66 (live would be ~123)
      const zcRep2 = getZeroCrossings(0.75, 0.9);      // replay ~ 66 (live would be ~132)
      const zcLiveLater = getZeroCrossings(0.9, 1.0);  // burst over: live 880 Hz x 0.1s ~ 88

      let hasNaN = false;
      for (let i = 0; i < dataL.length; i++) {
        if (Number.isNaN(dataL[i])) hasNaN = true;
      }

      return { zcCapture, zcRep1, zcRep2, zcLiveLater, hasNaN };
    });

    expect(result.hasNaN).toBe(false);
    expect(result.zcCapture).toBeGreaterThan(58);
    expect(result.zcCapture).toBeLessThan(74);
    expect(result.zcRep1).toBeGreaterThan(58);
    expect(result.zcRep1).toBeLessThan(74);
    expect(result.zcRep2).toBeGreaterThan(58);
    expect(result.zcRep2).toBeLessThan(74);
    expect(result.zcLiveLater).toBeGreaterThan(80);
    expect(result.zcLiveLater).toBeLessThan(96);
  });

  test('Hold/release', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { ensureBufferRepeaterWorklet, createBufferRepeater } = (window as unknown as any).__plWorkletTest;
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 2, sr);
      await ensureBufferRepeaterWorklet(ctx);
      const br = createBufferRepeater(ctx, 'br1');
      br.bind('mode', 1); // Insert: dry passes when idle, repeats replace dry while held

      // input tone STOPS at 0.7s — so anything audible after 0.8s can ONLY be held repeats
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      env.gain.value = 1;
      env.gain.setValueAtTime(1, 0.7);
      env.gain.linearRampToValueAtTime(0, 0.71);

      osc.connect(env);
      env.connect(br.inputs.in);
      br.outputs.out.connect(ctx.destination);
      osc.start();

      ctx.suspend(0.4).then(() => {
        br.holdRepeat!(true); // snaps to next grid boundary (0.45s @ 100 BPM grid 1/16)
        ctx.resume();
      });

      ctx.suspend(1.2).then(() => {
        br.holdRepeat!(false);
        ctx.resume();
      });

      const buffer = await ctx.startRendering();
      const dataL = buffer.getChannelData(0);

      const getRMS = (startSec: number, endSec: number) => {
        const start = Math.floor(startSec * sr);
        const end = Math.floor(endSec * sr);
        let sum = 0;
        for (let i = start; i < end; i++) sum += dataL[i] * dataL[i];
        return 10 * Math.log10(Math.sqrt(sum / (end - start)) + 1e-12);
      };

      const rmsBefore = getRMS(0, 0.3);    // dry tone (Insert idle passthrough)
      const rmsDuring = getRMS(0.8, 1.1);  // input is SILENT here — only held repeats can sound
      const rmsAfter = getRMS(1.4, 1.8);   // released + input silent -> silence proves release worked

      return { rmsBefore, rmsDuring, rmsAfter };
    });

    expect(result.rmsBefore).toBeGreaterThan(-60);
    expect(result.rmsDuring).toBeGreaterThan(-60);
    expect(result.rmsAfter).toBeLessThan(-60);
  });

  test('Gate mode silence', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { ensureBufferRepeaterWorklet, createBufferRepeater } = (window as unknown as any).__plWorkletTest;
      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 1, sr);
      await ensureBufferRepeaterWorklet(ctx);
      const br = createBufferRepeater(ctx, 'br1');
      br.bind('mode', 2); // Gate
      br.bind('gate', 2); // gate = 2 sixteenths
      
      const osc = ctx.createOscillator();
      osc.connect(br.inputs.in);
      br.outputs.out.connect(ctx.destination);
      osc.start();

      // trig at 0.2 snaps to the next grid boundary: 0.30s (grid = 0.15s @ 100 BPM).
      // gate 2 -> burst [0.30, 0.60): slot0 capture [0.30,0.45) is MUTED in Gate mode
      // (dry gated, repeats not yet sounding); slot1 [0.45,0.60) replays audibly.
      ctx.suspend(0.05).then(() => {
        br.triggerIns!.trig!(0.2);
        ctx.resume();
      });

      const buffer = await ctx.startRendering();
      const dataL = buffer.getChannelData(0);

      const getRMS = (startSec: number, endSec: number) => {
        const start = Math.floor(startSec * sr);
        const end = Math.floor(endSec * sr);
        let sum = 0;
        for (let i = start; i < end; i++) sum += dataL[i] * dataL[i];
        return 10 * Math.log10(Math.sqrt(sum / (end - start)) + 1e-12);
      };

      const rmsBefore = getRMS(0.05, 0.25); // Gate idle = silence (Ableton semantics)
      const rmsInside = getRMS(0.46, 0.58); // slot1 replay window
      const rmsAfter = getRMS(0.7, 0.95);   // burst over -> Gate idle silence again
      
      return { rmsBefore, rmsInside, rmsAfter };
    });
    
    expect(result.rmsBefore).toBeLessThan(-60);
    expect(result.rmsInside).toBeGreaterThan(-60);
    expect(result.rmsAfter).toBeLessThan(-60);
  });
});

test.describe('Grain Delay artifact detector', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__plWorkletTest !== undefined,
    );
  });

  test('S1 pitch-up read-head overtake stays click-free', async ({ page }) => {
    const result = await page.evaluate(async (detectSrc) => {
      const { detectClicks } = new Function(detectSrc + '; return { detectClicks, rmsDbFile };')() as any;
      const { ensureGrainWorklet, createGrainDelay } = (window as unknown as any).__plWorkletTest;

      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 3, sr);
      await ensureGrainWorklet(ctx);

      const gd = createGrainDelay(ctx, 'gd-s1');
      gd.bind('mix', 100);
      gd.bind('time', 350);
      gd.bind('size', 700);
      gd.bind('density', 2);
      gd.bind('pitch', 12);
      gd.bind('spray', 0);
      gd.bind('rndPitch', 0);
      gd.bind('spread', 0);
      gd.bind('feedback', 0);

      const dc = ctx.createConstantSource();
      dc.offset.value = 0.5;
      dc.connect(gd.inputs.in);
      gd.outputs.out.connect(ctx.destination);
      dc.start();

      const buffer = await ctx.startRendering();
      const left = detectClicks(buffer.getChannelData(0), sr, 0.5, 3.0);
      const right = detectClicks(buffer.getChannelData(1), sr, 0.5, 3.0);
      return { maxJump: Math.max(left.maxJump, right.maxJump), count: left.count + right.count };
    }, DETECT_SRC);

    expect(result.maxJump).toBeLessThan(0.05);
  });

  test('S2 freeze read-window integrity keeps frozen cloud audible', async ({ page }) => {
    const result = await page.evaluate(async (detectSrc) => {
      const { detectClicks, rmsDbFile } = new Function(detectSrc + '; return { detectClicks, rmsDbFile };')() as any;
      const { ensureGrainWorklet, createGrainDelay } = (window as unknown as any).__plWorkletTest;

      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 3.5, sr);
      await ensureGrainWorklet(ctx);

      const gd = createGrainDelay(ctx, 'gd-s2');
      gd.bind('mix', 100);
      gd.bind('time', 50);
      gd.bind('size', 500);
      gd.bind('density', 2);
      gd.bind('pitch', 0);
      gd.bind('spray', 0);
      gd.bind('rndPitch', 0);
      gd.bind('spread', 0);
      gd.bind('feedback', 0);

      const dc = ctx.createConstantSource();
      dc.offset.value = 0.5;
      dc.connect(gd.inputs.in);
      gd.outputs.out.connect(ctx.destination);
      dc.start();

      ctx.suspend(0.6).then(async () => {
        gd.bind('freeze', 1);
        await new Promise((r) => setTimeout(r, 25));
        void ctx.resume();
      });

      const buffer = await ctx.startRendering();
      const ch0 = buffer.getChannelData(0);
      const left = detectClicks(ch0, sr, 1.5, 3.5);
      const right = detectClicks(buffer.getChannelData(1), sr, 1.5, 3.5);
      return {
        rmsDb: rmsDbFile(ch0, sr, 1.5, 3.5),
        maxJump: Math.max(left.maxJump, right.maxJump),
        count: left.count + right.count,
      };
    }, DETECT_SRC);

    expect(result.rmsDb).toBeGreaterThan(-12);
    expect(result.maxJump).toBeLessThan(0.05);
  });

  test('S3 density compensation changes without a zipper step', async ({ page }) => {
    const result = await page.evaluate(async (detectSrc) => {
      const { detectClicks } = new Function(detectSrc + '; return { detectClicks, rmsDbFile };')() as any;
      const { ensureGrainWorklet, createGrainDelay } = (window as unknown as any).__plWorkletTest;

      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 2, sr);
      await ensureGrainWorklet(ctx);

      const gd = createGrainDelay(ctx, 'gd-s3');
      gd.bind('mix', 100);
      gd.bind('time', 100);
      gd.bind('size', 400);
      gd.bind('density', 2);
      gd.bind('pitch', 0);
      gd.bind('spray', 0);
      gd.bind('rndPitch', 0);
      gd.bind('spread', 0);
      gd.bind('feedback', 0);

      const dc = ctx.createConstantSource();
      dc.offset.value = 0.5;
      dc.connect(gd.inputs.in);
      gd.outputs.out.connect(ctx.destination);
      dc.start();

      ctx.suspend(1.0).then(async () => {
        gd.bind('density', 8);
        await new Promise((r) => setTimeout(r, 25));
        void ctx.resume();
      });

      const buffer = await ctx.startRendering();
      const ch0 = buffer.getChannelData(0);
      const ch1 = buffer.getChannelData(1);
      const left = detectClicks(ch0, sr, 0.8, 1.6);
      const right = detectClicks(ch1, sr, 0.8, 1.6);
      const preLeft = detectClicks(ch0, sr, 0.8, 0.999);
      const preRight = detectClicks(ch1, sr, 0.8, 0.999);
      return {
        maxJump: Math.max(left.maxJump, right.maxJump),
        preMaxJump: Math.max(preLeft.maxJump, preRight.maxJump),
        count: left.count + right.count,
      };
    }, DETECT_SRC);

    expect(result.preMaxJump).toBeLessThan(0.05);
    expect(result.maxJump).toBeLessThan(0.05);
  });
});

test.describe('Buffer Repeater artifact detector', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__plWorkletTest !== undefined,
    );
  });

  test('S4 retrigger while active fades instead of hard-cutting', async ({ page }) => {
    const result = await page.evaluate(async (detectSrc) => {
      const { detectClicks } = new Function(detectSrc + '; return { detectClicks, rmsDbFile };')() as any;
      const { ensureBufferRepeaterWorklet, createBufferRepeater } = (window as unknown as any).__plWorkletTest;

      const sr = 48000;
      const ctx = new OfflineAudioContext(2, Math.floor(sr * 2.2), sr);
      await ensureBufferRepeaterWorklet(ctx);

      const br = createBufferRepeater(ctx, 'br-s4');
      br.bind('mode', 1);
      br.bind('gate', 8);
      br.bind('grid', 2);
      br.bind('variation', 0);
      br.bind('pitch', 0);
      br.bind('pitchDecay', 0);
      br.bind('decay', 0);
      br.bind('chance', 0);

      const dc = ctx.createConstantSource();
      dc.offset.value = 0.5;
      dc.connect(br.inputs.in);
      br.outputs.out.connect(ctx.destination);
      dc.start();

      ctx.suspend(0.1).then(async () => {
        br.triggerIns.trig(0.45);
        await new Promise((r) => setTimeout(r, 25));
        void ctx.resume();
      });
      ctx.suspend(0.6506667).then(async () => {
        br.triggerIns.trig(0.65);
        await new Promise((r) => setTimeout(r, 25));
        void ctx.resume();
      });

      const buffer = await ctx.startRendering();
      const left = detectClicks(buffer.getChannelData(0), sr, 0.55, 2.0);
      const right = detectClicks(buffer.getChannelData(1), sr, 0.55, 2.0);
      return { maxJump: Math.max(left.maxJump, right.maxJump), count: left.count + right.count };
    }, DETECT_SRC);

    expect(result.maxJump).toBeLessThan(0.05);
  });

  test('S5 long hold auto-releases before the ring laps', async ({ page }) => {
    const result = await page.evaluate(async (detectSrc) => {
      const { detectClicks } = new Function(detectSrc + '; return { detectClicks, rmsDbFile };')() as any;
      const { ensureBufferRepeaterWorklet, createBufferRepeater } = (window as unknown as any).__plWorkletTest;

      const sr = 48000;
      const ctx = new OfflineAudioContext(2, Math.floor(sr * 6.5), sr);
      await ensureBufferRepeaterWorklet(ctx);

      const br = createBufferRepeater(ctx, 'br-s5');
      br.bind('mode', 1);
      br.bind('grid', 2);
      br.bind('variation', 0);
      br.bind('pitch', -12);
      br.bind('pitchDecay', 0);
      br.bind('decay', 0);
      br.bind('chance', 0);

      const dc = ctx.createConstantSource();
      dc.offset.value = 0.5;
      dc.offset.setValueAtTime(-0.5, 1.2);
      dc.connect(br.inputs.in);
      br.outputs.out.connect(ctx.destination);
      dc.start();

      ctx.suspend(0.4).then(async () => {
        br.holdRepeat(true);
        await new Promise((r) => setTimeout(r, 25));
        void ctx.resume();
      });

      const buffer = await ctx.startRendering();
      const left = detectClicks(buffer.getChannelData(0), sr, 1.0, 6.4);
      const right = detectClicks(buffer.getChannelData(1), sr, 1.0, 6.4);
      return { maxJump: Math.max(left.maxJump, right.maxJump), count: left.count + right.count };
    }, DETECT_SRC);

    expect(result.maxJump).toBeLessThan(0.05);
  });

  test('S6 mode saturation morphs without a level step', async ({ page }) => {
    const result = await page.evaluate(async (detectSrc) => {
      const { detectClicks } = new Function(detectSrc + '; return { detectClicks, rmsDbFile };')() as any;
      const { ensureBufferRepeaterWorklet, createBufferRepeater } = (window as unknown as any).__plWorkletTest;

      const sr = 48000;
      const ctx = new OfflineAudioContext(2, sr * 2, sr);
      await ensureBufferRepeaterWorklet(ctx);

      const br = createBufferRepeater(ctx, 'br-s6');
      br.bind('mode', 0);
      br.bind('chance', 0);

      const dc = ctx.createConstantSource();
      dc.offset.value = 1.5;
      dc.connect(br.inputs.in);
      br.outputs.out.connect(ctx.destination);
      dc.start();

      ctx.suspend(1.0).then(async () => {
        br.bind('mode', 1);
        await new Promise((r) => setTimeout(r, 25));
        void ctx.resume();
      });

      const buffer = await ctx.startRendering();
      const left = detectClicks(buffer.getChannelData(0), sr, 0.5, 1.8);
      const right = detectClicks(buffer.getChannelData(1), sr, 0.5, 1.8);
      return { maxJump: Math.max(left.maxJump, right.maxJump), count: left.count + right.count };
    }, DETECT_SRC);

    expect(result.maxJump).toBeLessThan(0.05);
  });

  test('S7 variation pitch-up does not read ahead of written audio', async ({ page }) => {
    const result = await page.evaluate(async (detectSrc) => {
      const { detectClicks } = new Function(detectSrc + '; return { detectClicks, rmsDbFile };')() as any;
      const { ensureBufferRepeaterWorklet, createBufferRepeater } = (window as unknown as any).__plWorkletTest;

      const sr = 48000;
      const ctx = new OfflineAudioContext(2, Math.floor(sr * 5.7), sr);
      await ensureBufferRepeaterWorklet(ctx);

      const br = createBufferRepeater(ctx, 'br-s7');
      br.bind('mode', 1);
      br.bind('grid', 0);
      br.bind('variation', 3);
      br.bind('pitch', 12);
      br.bind('gate', 4);
      br.bind('pitchDecay', 0);
      br.bind('decay', 0);
      br.bind('chance', 0);

      const dc = ctx.createConstantSource();
      dc.offset.value = 0.5;
      dc.connect(br.inputs.in);
      br.outputs.out.connect(ctx.destination);
      dc.start();

      for (let k = 0; k < 6; k++) {
        const suspendAt = 0.35 + 0.9 * k;
        const trigAt = 0.45 + 0.9 * k;
        ctx.suspend(suspendAt).then(async () => {
          br.triggerIns.trig(trigAt);
          await new Promise((r) => setTimeout(r, 25));
          void ctx.resume();
        });
      }

      const buffer = await ctx.startRendering();
      const left = detectClicks(buffer.getChannelData(0), sr, 0.4, 5.6);
      const right = detectClicks(buffer.getChannelData(1), sr, 0.4, 5.6);
      return { maxJump: Math.max(left.maxJump, right.maxJump), count: left.count + right.count };
    }, DETECT_SRC);

    expect(result.maxJump).toBeLessThan(0.05);
  });
});
