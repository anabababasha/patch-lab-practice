# PatchLab — DESIGN.md

Format: YAML tokens + rationale (per project design standard). Inject the YAML block verbatim into agent prompts; lint rendered UI against it.

The brief pins the direction: the harness.design schematic language — near-black canvas, dotted grid, pin-table nodes, **desaturated world / one saturated traced path**. Every choice below serves that single signature moment.

```yaml
meta:
  name: PatchLab
  direction: "instrument-grade schematic; quiet until traced"
  signature: "trace glow — hover a pin, the full signal path ignites while everything else stays ashen"

color:
  canvas:            "#0A0C0F"   # near-black, slightly blue-cold
  grid-dot:          "#1A1E25"   # dotted grid, barely-there
  surface:           "#12151A"   # node body
  surface-raised:    "#171B21"   # node header, palette, inspector
  border:            "#262C35"
  border-active:     "#9AA3AF"   # selected node outline (neutral, not colored)
  text-primary:      "#E8EAED"
  text-secondary:    "#8A919C"   # pin labels at rest
  text-disabled:     "#4A505A"
  wire-idle:         "#3A404A"   # ALL wires at rest; color only earns its place when traced
  signal-1:          "#2ECC71"   # green   (ref: IGN 1)
  signal-2:          "#FF8A1E"   # orange  (ref: INJ 1)
  signal-3:          "#FFC933"   # yellow  (ref: INJ 2)
  signal-4:          "#3B9CFF"   # blue    (ref: IGN 2)
  network:           "#8B6CFF"   # reserved: Dante/AES67 flows (Build 4)
  control:           "#B8C0CC"   # reserved: dashed control wires (Build 5)
  danger:            "#FF4D4D"   # clip, invalid wire attempt, delete
  meter-rms:         "#2ECC71"
  meter-peak:        "#FFC933"
  meter-clip:        "#FF4D4D"

type:
  ui:      "Inter, system-ui, sans-serif"          # labels, buttons, inspector
  data:    "'JetBrains Mono', ui-monospace, monospace"  # pin numbers, dB/Hz values, meter scales
  scale:
    node-title:  "13px / 600"
    pin-label:   "12px / 450"
    pin-index:   "11px / 500 mono, text-secondary"
    param-value: "12px / 500 mono, tabular-nums"
    topbar:      "13px / 500"
  rules:
    - "Numbers are always mono + tabular-nums; units (dB, Hz, ms) in text-secondary."
    - "No uppercase tracking-wide labels except category eyebrows in the palette."

layout:
  grid-dot-spacing: 20        # px at zoom 1; dots not lines
  node-width: 200             # px; pin rows full-width
  pin-row-height: 26
  node-radius: 8
  wire-style: "orthogonal (React Flow smoothstep, borderRadius 10) — like the reference's rounded right-angle runs"
  wire-width-idle: 1.5
  wire-width-traced: 2.5
  handle-size: 8              # circular, sits ON the node edge like a cavity

states:
  idle:
    wires: wire-idle
    nodes: surface + border
  traced:                     # the signature
    wire: "its signal-N hue at 100% + outer glow: 0 0 8px 1px color@35%"
    nodes-on-path: "border-active outline, header text-primary"
    everything-else: "unchanged — do NOT dim further; the world is already quiet"
  selected-pin: "handle fills with its signal hue + 2px halo"
  invalid-wire-drag: "ghost wire in danger, snaps back; toast explains the rule (e.g. 'Inputs accept one wire — use a Mixer to sum')"
  audio-suspended: "TopBar shows solid 'Start Audio ▸' pill in signal-1; nothing pulses or begs"

motion:
  trace-in: "wire glow fades in 120ms ease-out; no draw-on animation"
  meters: "30fps canvas, no CSS animation"
  everything-else: "≤150ms opacity/transform only; respect prefers-reduced-motion (trace becomes instant, meters stay)"

quality-floor:
  - keyboard: Del, Esc (clear trace), Cmd/Ctrl+Z
  - focus-visible rings on all interactive elements (border-active, 2px)
  - touch: handles get 24px invisible hit area; palette becomes bottom sheet < 768px
  - contrast: pin labels ≥ 4.5:1 on surface
```

## Rationale

**Why idle wires are gray.** In the reference, color is *information about attention*, not decoration — the harness sits ashen until you ask about one circuit. Copying the palette without copying this restraint would produce a rainbow spaghetti board (see the 35-pin VCU screenshot: legible only because hover isolates). So: all wires idle at `wire-idle`; a wire's `colorIndex` hue exists only in traced state and in its pin-handle dot.

**Why mono for data.** This is an instrument. Pin indices, dB, Hz, and meter scales are read against each other; tabular mono figures make columns scannable the way the reference's pin tables are. Inter carries everything conversational.

**Why the selection outline is neutral.** Saturation is reserved exclusively for the trace. Selection is a workbench state, not a signal state.

**One risk, spent deliberately.** The trace glow is the only glow in the app. No gradients, no glass, no ambient animation. If a future element wants to shine, it must argue with this paragraph first.
