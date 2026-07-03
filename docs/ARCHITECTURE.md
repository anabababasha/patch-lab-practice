# PatchLab — Architecture

A browser-based signal-flow designer for practicing Q-SYS-style system design, with a **real Web Audio DSP engine** behind every wire. Working title: **PatchLab** (rename freely — avoid "Q-SYS" in the public repo name since it's a QSC trademark).

Reference UX: harness.design (Instagram reels). Core idea borrowed: **one graph, two projections, pin-level trace highlighting** — hover any pin and the entire signal path lights up while everything else stays desaturated.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| App | React 18 + TypeScript + Vite | Standard stack, GH Pages friendly |
| Canvas | **React Flow (@xyflow/react)** | Custom nodes (pin tables), custom edges (orthogonal), pan/zoom, minimap for free |
| State | Zustand | Single source of truth; React Flow state derived from it |
| Audio | Web Audio API (no libs) | Direct AudioNode graph, already proven in Wave Lab / Room·Aco·Meter |
| Persistence | localStorage autosave + JSON export/import | Designs are portable files |
| Deploy | GitHub Pages via Actions | HTTPS (required for mic input) |

---

## 2. Data model (single source of truth)

```ts
type SignalKind = 'audio' | 'control' | 'network';

interface PinSpec {
  id: string;            // 'in_1', 'out_L'
  label: string;         // 'Input 1'
  direction: 'in' | 'out';
  kind: SignalKind;      // Build 1: audio only
}

interface ParamSpec {
  id: string; label: string; unit: 'dB' | 'Hz' | 'ms' | '%' | '';
  min: number; max: number; step: number; default: number;
  taper?: 'lin' | 'log';                 // log for Hz
}

interface ComponentSpec {
  type: string;                          // 'gain', 'sine_gen'
  name: string; category: 'source' | 'dsp' | 'output';
  pins: PinSpec[];
  params: ParamSpec[];
  internalRouting: Record<string, string[]>;  // inPinId -> outPinIds it feeds (for tracing)
  createAudio(ctx: AudioContext): AudioUnit;  // see §3
}

interface NodeInstance {
  id: string; type: string; label: string;
  x: number; y: number;
  params: Record<string, number>;
}

interface PinRef { nodeId: string; pinId: string }

interface Wire { id: string; from: PinRef; to: PinRef; colorIndex: number }

interface Design {
  version: 1; name: string;
  nodes: NodeInstance[]; wires: Wire[];
}
```

Rules enforced in the store, not the UI:
- `out → in` only; one wire per **input** pin (fan-out from outputs is allowed, fan-in is not — matches Q-SYS behavior; use a Mixer for summing).
- No self-loops. (Cycles across nodes: reject in Build 1; feedback paths are a later feature with an explicit Delay requirement.)
- Deleting a node deletes its wires atomically.

Zustand store slices: `design` (nodes/wires — undoable), `ui` (selection, traceSet, palette open), `audio` (context state, meter registry).

---

## 3. Audio engine

### AudioUnit contract
Every component factory returns:

```ts
interface AudioUnit {
  inputs: Record<string, AudioNode>;    // pinId -> node to connect INTO
  outputs: Record<string, AudioNode>;   // pinId -> node to connect FROM (post-analyser)
  bind(paramId: string, value: number): void;  // live, no rebuild
  analysers: Record<string, AnalyserNode>;     // one per output pin, inline (audio passes through)
  dispose(): void;
}
```

### Compile strategy (Build 1: simple and correct)
- One `AudioContext` singleton, created lazily; **"Start Audio" button** gates `ctx.resume()` (browser gesture requirement).
- On any structural change (node/wire add/remove): **full teardown + rebuild**, debounced 50 ms. Small graphs make this inaudible-cheap; diffing is a later optimization.
- On param change: `bind()` only — writes to `AudioParam` with `setTargetAtTime` (10 ms smoothing). No rebuild, no zipper noise.
- Master chain (always present inside the Master Output component):
  `sum → DynamicsCompressorNode(threshold −1 dB, ratio 20:1, knee 0, attack 3 ms, release 250 ms) → ctx.destination`
  This is the **safety limiter** — non-negotiable, protects ears and speakers.

### Build 1 component set
| Type | Internals | Params |
|---|---|---|
| `sine_gen` | OscillatorNode → GainNode | freq 20–20k Hz (log), level −60…0 dB (default **−20 dB**) |
| `noise_gen` | looped AudioBufferSource (pink, Voss-McCartney, 4 s buffer) → GainNode | level −60…0 dB (default −20) |
| `gain` | GainNode | gain −60…+12 dB, mute |
| `master_out` | limiter → destination | level −60…0 dB |

dB↔linear helpers in `lib/units.ts`: `dbToGain(db) = 10^(db/20)`, clamp, format.

### Meters
- Every output pin gets an inline `AnalyserNode` (fftSize 512).
- One global rAF loop (`MeterService`), throttled to 30 fps, reads `getFloatTimeDomainData` into a shared Float32Array, computes RMS + peak-hold per analyser, and **draws directly to a small `<canvas>` in each node header** — no React re-renders on the audio path.
- Colors: RMS green, peak ticks yellow, ≥ −0.5 dBFS clip = red segment latching 1 s.

---

## 4. Trace highlighting (the signature interaction)

State: `traceSet: { nodes: Set<string>, wires: Set<string>, pins: Set<string> } | null`.

Trigger: hover **or** click any pin or wire (click pins it until Esc / canvas click).

Algorithm — bidirectional BFS over the *combined* graph (wires + each component's `internalRouting`):

```
downstream(pin):
  if pin is out: follow wires → target in-pins → via internalRouting → out-pins → …
upstream(pin): mirror image
trace = downstream(p) ∪ upstream(p) ∪ {p}
```

O(V+E), runs synchronously on hover. Rendering: everything **not** in the set drops to idle desaturation; wires in the set render in their full `colorIndex` hue with a soft outer glow; member nodes get the active border. This is the harness.design moment — one saturated path over a quiet world.

Wire colors cycle through the 4 signal hues (see DESIGN.md) by `colorIndex` assigned at creation, so parallel runs stay distinguishable like INJ1/INJ2/IGN1/IGN2 in the reference.

---

## 5. UI layout (mobile-aware, desktop-first)

```
┌──────────────────────────────────────────────┐
│ TopBar: name · Start Audio ▸ · Save · Export │
├───────┬──────────────────────────────────────┤
│Palette│                                      │
│(rail; │        React Flow canvas             │
│bottom │   dotted grid · minimap · zoom       │
│sheet  │                                      │
│on sm) ├──────────────────────────────────────┤
│       │ Inspector: params of selected node   │
└───────┴──────────────────────────────────────┘
```

- **Node = pin table** (see DESIGN.md): header (icon, name, meter canvas), rows of pins — number, label, Handle left (in) / right (out).
- Inspector: sliders + numeric entry per ParamSpec, dB/Hz formatted, double-tap to reset default.
- Keyboard: Del removes selection, ⌘Z undo (zustand temporal or simple stack), Esc clears trace.

---

## 6. Phase roadmap (matches your ranking)

**Build 1 — Core editor + audible engine** (this session's prompt)
Scaffold, canvas, palette, 4 components, wiring rules, trace highlight, compile-on-change, meters, Start Audio gate, localStorage autosave, JSON export/import, GH Pages workflow.

**Build 2 — Full DSP bench** (priority 1) ✅ SHIPPED (v0.2.0, + LFO/control pins, Analyzer scope, dynamic Router trace)
PEQ 4-band (Biquad chain), Compressor (with GR meter), HPF/LPF, Delay, Mixer 4×2, Router 4×4 (gain matrix; `internalRouting` becomes *dynamic* — trace follows actual routing state), Media Player (file drop), **Mic Input** (getUserMedia, echoCancellation/AGC off), pink-noise + sine already done.

**Build 3 — Scenarios engine** (priority 2)
Task cards ("Build a hybrid meeting-room chain: Mic → AEC-placeholder → PEQ → Comp → Router → Program + USB out"). A scenario = target-graph spec + validator (graph isomorphism against constraints: required component types, required path, param ranges). Pass/fail with hints that use the trace highlighter to *show* the missing link. This is where the course DNA from the Arabic tracks returns — but on top of a live tool.

**Build 4 — Network / Dante view** (priority 3)
Second projection of the same design: devices (Core, switch, endpoints) with **Tx→Rx subscription flows** drawn like the harness bulkhead pass-throughs; hover a flow → highlights the corresponding schematic path (dual-view sync). Simulated clocking/subscription states, no real network.

**Build 5 — Control layer** (priority 4)
Control pins (`kind: 'control'`), toggle/knob/LED components, dashed control wires, a small UCI-style panel page bound to control values.

---

## 7. Repo & deploy

- Repo: `anabababasha/patch-lab` (public). Vite `base: '/patch-lab/'`.
- `.github/workflows/deploy.yml`: build on push to `main`, deploy `dist/` to Pages.
- Mic input works on GH Pages (HTTPS). Note in README: iOS Safari requires the Start Audio tap before any sound.
- Suggested structure:

```
src/
  app/store.ts            # zustand slices
  audio/engine.ts         # compile, teardown, MeterService
  audio/units/*.ts        # one file per component factory
  components/registry.ts  # ComponentSpec table
  graph/trace.ts          # BFS trace
  ui/nodes/PinTableNode.tsx
  ui/edges/SignalEdge.tsx
  ui/Palette.tsx  ui/Inspector.tsx  ui/TopBar.tsx
  lib/units.ts            # dB/Hz helpers
  design/tokens.ts        # generated from DESIGN.md
```

## 8. Risks / decisions on file

- **Fan-in forbidden** at input pins (Q-SYS-accurate; Mixer sums). Keeps audio graph unambiguous.
- **Full rebuild on structure change** accepted for Phase 1; revisit only if designs exceed ~60 nodes.
- **AudioWorklet avoided** in Build 1 (pink noise via buffer). Worklets enter with the Router/metering upgrades if needed.
- **Trademark**: UI says "inspired by professional DSP designers"; no QSC marks or copied iconography.
