export type SignalKind = 'audio' | 'control' | 'network';
export type PinDirection = 'in' | 'out';

export interface PinSpec {
  id: string;
  label: string;
  direction: PinDirection;
  kind: SignalKind;
}

export interface ParamSpec {
  id: string;
  label: string;
  unit: 'dB' | 'Hz' | 'ms' | '%' | '';
  min: number;
  max: number;
  step: number;
  default: number;
  taper?: 'lin' | 'log';
  kind?: 'slider' | 'toggle';
}

/** Contract every audio component factory fulfils. */
export interface AudioUnit {
  /** pinId -> node to connect INTO */
  inputs: Record<string, AudioNode>;
  /** pinId -> node to connect FROM (post-analyser) */
  outputs: Record<string, AudioNode>;
  /** live param update — no rebuild, smoothed */
  bind(paramId: string, value: number): void;
  /** inline analysers (audio passes through them) for metering */
  analysers: Record<string, AnalyserNode>;
  dispose(): void;
}

export interface ComponentSpec {
  type: string;
  name: string;
  category: 'source' | 'dsp' | 'output';
  pins: PinSpec[];
  params: ParamSpec[];
  /** inPinId -> outPinIds it feeds (used by the trace algorithm) */
  internalRouting: Record<string, string[]>;
  createAudio(ctx: AudioContext): AudioUnit;
}

export interface NodeInstance {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  params: Record<string, number>;
}

export interface PinRef {
  nodeId: string;
  pinId: string;
}

export interface Wire {
  id: string;
  from: PinRef; // always an OUT pin
  to: PinRef; // always an IN pin
  colorIndex: number; // 1..4 -> signal hue
}

export interface Design {
  version: 1;
  name: string;
  nodes: NodeInstance[];
  wires: Wire[];
}

export const pinKey = (r: PinRef) => `${r.nodeId}:${r.pinId}`;
