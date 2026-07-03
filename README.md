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

Build 2: full DSP bench (PEQ, compressor, mixer, router with dynamic trace routing, delay, filters, media player, mic input) · Build 3: guided training scenarios · Build 4: network/Dante dual-view · Build 5: control layer. See `docs/ARCHITECTURE.md`.
