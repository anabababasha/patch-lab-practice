# PatchLab

A browser-based audio signal-flow designer for practicing Q-SYS-style system design — with a real Web Audio engine behind every wire. Hover any pin and the full signal path lights up; everything else stays quiet.

**Build 2** ships a full DSP bench — 16 components:

- **Sources**: Signal Generator (sine/square/saw/tri), Noise (pink/white), **Media Player** (load your own audio files), **Mic Input**
- **Modulation**: LFO with **control pins** — dashed control wires drive Mod inputs on Gain, Filter, Delay, and Panner (tremolo, filter sweeps, chorus/vibrato, auto-pan)
- **DSP**: Gain, Filter (LP/HP/BP/notch), 4-band Parametric EQ, Compressor, Delay w/ feedback, Reverb (synthesized IR), Distortion, Panner
- **Routing**: Mixer 4×1 (sum multiple chains), Router 4×4 with **dynamic trace** — the highlight follows the actual crosspoint state
- **Metering**: Analyzer node with a live waveform/spectrum scope drawn in the node

Plus everything from Build 1: Q-SYS-accurate wiring rules (one wire per input, kind-matched pins, no feedback loops), pin-level trace highlighting, live smoothed parameters, per-node meters (RMS + peak-hold + clip latch), autosave, JSON export/import, undo.

> Media files are decoded in-memory and are **not** persisted — reload the file after a page refresh. Old Build 1 designs load automatically (`sine_gen` is aliased to `signal_gen`).

Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (system design + 5-build roadmap) · [`docs/DESIGN.md`](docs/DESIGN.md) (token system).

## Performance layer

Build 3 adds trigger signals (dotted wires) for real-time events. Try this kick drum recipe:

1. Signal Generator — Sine, Freq 50 Hz, Level −6 dB
2. Gain — Gain −60 dB, Mod Amt 100%
3. Envelope A — Attack 1 ms, Decay 60 ms → wire Env Out to Signal Generator's **Pitch** input, set Signal Generator's `pitchAmt` to 2400
4. Envelope B — Attack 0.5 ms, Decay 250 ms → wire Env Out to Gain's **Mod** input, Gain's Mod Amt already at 100%
5. Trigger Pad → wire Trig Out to BOTH Envelope A's and Envelope B's Trig input (fan-out, per the Build 3a fix)
6. Signal Generator → Gain → Master Output

Tapping the pad should produce a clean, punchy kick drum per tap.

## Pattern library

Build 4 adds a global transport (BPM + Play/Stop) and a Step Sequencer. The step sequencer uses a sample-accurate lookahead scheduler to emit triggers in perfect time, turning envelopes into a drum machine. 

The sequencer includes a robust rhythm pattern library spanning six traditions: Arabic Iqa\u02bfat, West African 12/8, Latin & Clave, Flamenco Comp\u00e1s, Balkan & Turkish Aksak, and Electronic. Odd meters are fully supported — the Sama'i preset configures a 10/8 cycle seamlessly. Patterns are data, not code — corrections welcome. They can be found and easily edited in `src/patterns/index.ts`. Load the "Drum Machine (Maqsum)" example from the Examples menu, then browse the library in the System Panel to hear other traditions!

### Verifying patterns
Patterns live in `src/patterns/index.ts` as plain data; each carries `status` and `source`; the path from draft → verified is (1) cross-check against a citable source or authoritative recording, (2) listening review at tradition-appropriate tempo, (3) set `status: 'verified'` and cite the source in the same commit. Corrections are ordinary code commits — the library's git history IS its provenance record.

## Layers

Build 5a introduces **Layers**, allowing you to organize complex designs into named, Q-SYS-style schematic view pages.
- **View-only organization**: Layers are purely visual. The audio engine, trace algorithm, and wires are always global. The design will sound identical regardless of which layer is actively visible.
- **Cross-layer signals**: When viewing a single layer, pins that wire to components on other hidden layers show a purple outer ring and indicate their destination on hover.

## Recording

PatchLab allows you to capture your performances directly to an audio file. Add a **Recorder** node from the Outputs category and place it anywhere in your signal path (typically between your final Mixer and the Master Output).
- **Format**: Captures to high-quality WAV or WebM.
- **Mid-take editing**: The recording engine survives structural changes. You can patch live, add nodes, or delete nodes while the take rolls. Even if the Recorder node itself is deleted during a take, your performance is safely finalized and downloaded.

## Looping

The **Looper** node allows you to capture a performance through it, loop it instantly, and layer live playing over it. When **Bar sync** is on and the transport is playing, recording actions automatically quantize to the transport grid so your loops lock perfectly in time with the drum machine.

When a loop is captured, the Looper opens a waveform window. Drag either edge to trim the live loop region; synced loops snap to the 16th-note grid first, then to nearby zero-crossings to keep seams clean. The Looper can also Normalize quiet captures, Reverse the buffer, and switch Speed between half-time, normal, and double-time tape-style playback while the loop keeps running.

## Visual EQ

The **Filter** and **Parametric EQ** nodes show a live spectrum underlay with the current response curve; Parametric EQ bands can be dragged directly on the curve.

## Develop

```bash
npm install
npm run dev
```

Open the printed URL. Add components from the palette, wire out → in, press **Start Audio ▸** (browsers require a tap before sound — on iOS this is mandatory), and pull the Gain slider.

`npm run build` type-checks and produces `dist/`.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.

1. Create a **public** repo named `patch-lab` on the target GitHub account.
2. Push this folder:
   ```bash
   git init
   git add -A
   git commit -m "Build 1: core editor + live audio engine"
   git branch -M main
   git remote add origin https://github.com/<user>/patch-lab.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Source: GitHub Actions**.
4. Wait for the action to finish → the app is live at `https://<user>.github.io/patch-lab/`.

> Renaming the repo? Update `base` in `vite.config.ts` to `'/<new-name>/'`.

## Safety

The Master Output always runs through a brickwall-style limiter (−1 dB ceiling). The master meter taps **pre**-limiter, so you can see an overdriven sum without hearing one. Generators default to −20 dB. Still: start with your system volume low.

## Roadmap

Build 2: full DSP bench (PEQ, compressor, mixer, router with dynamic trace routing, delay, filters, media player, mic input) · Build 3: triggers and real-time events · Build 4: global transport, sequencers, drum machines · Build 5: control layer. See `docs/ARCHITECTURE.md`.
