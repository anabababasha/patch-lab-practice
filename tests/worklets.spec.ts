import { test, expect } from '@playwright/test';

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
        // tone sounds until 0.6s — so at freeze time (0.45s) the grain read-window
        // (time = 100ms behind the head) contains TONE, not silence
        env.gain.value = 1;
        env.gain.setValueAtTime(1, 0.6);
        env.gain.linearRampToValueAtTime(0, 0.61);

        osc.connect(env);
        env.connect(gd.inputs.in);
        gd.outputs.out.connect(ctx.destination);
        osc.start();

        if (frozen) {
          ctx.suspend(0.45).then(() => {
            gd.bind('freeze', 1);
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
