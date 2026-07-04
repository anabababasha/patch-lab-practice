export type SignalKind = 'audio' | 'control' | 'network' | 'trigger';
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
  unit: 'dB' | 'Hz' | 'ms' | '%' | 's' | '';
  min: number;
  max: number;
  step: number;
  default: number;
  taper?: 'lin' | 'log';
  kind?: 'slider' | 'toggle' | 'select';
  /** for kind 'select': value is the option index */
  options?: string[];
  hidden?: boolean;
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
  /** optional high-resolution analyser for the Analyzer scope display */
  scope?: AnalyserNode;
  /** optional event triggers, e.g. envelope fire */
  triggerIns?: Record<string, (time?: number) => void>;
  dispose(): void;
}

export type InternalRouting =
  | Record<string, string[]>
  | ((params: Record<string, number>) => Record<string, string[]>);

export interface ComponentSpec {
  type: string;
  name: string;
  category: 'source' | 'mod' | 'dsp' | 'routing' | 'meter' | 'output';
  pins: PinSpec[];
  params: ParamSpec[];
  /** inPinId -> outPinIds it feeds (used by the trace algorithm);
   *  function form = routing depends on params (e.g. Router) */
  internalRouting: InternalRouting;
  help?: {
    summary: string;
    tips: string[];
    flows?: Array<{
      title: string;
      chain: Array<{
        label: string;
        kind?: 'audio' | 'control' | 'trigger';
      }>;
    }>;
  };
  /** special node body renderers */
  display?: 'scope' | 'media' | 'mic' | 'trigger' | 'sequencer';
  createAudio(ctx: AudioContext, nodeId: string): AudioUnit;
}

export interface NodeInstance {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  params: Record<string, number>;
  /** small string metadata (e.g. loaded file name) — optional, additive */
  meta?: Record<string, string>;
  layerId?: string;
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
  kind?: SignalKind; // 'audio' (default) | 'control' -> dashed rendering
}

export interface Layer {
  id: string;
  name: string;
}

export interface Design {
  version: 1;
  name: string;
  layers?: Layer[];
  nodes: NodeInstance[];
  wires: Wire[];
}

export const pinKey = (r: PinRef) => `${r.nodeId}:${r.pinId}`;
