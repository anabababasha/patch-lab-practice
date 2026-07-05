import React, { memo, useCallback, useRef, type CSSProperties } from 'react';
import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react';
import { useApp } from '../../app/store';
import { registry } from '../../components/registry';
import { pinKey, type ComponentSpec, type NodeInstance, type ParamSpec } from '../../lib/types';
import { clamp, roundToStep } from '../../lib/units';
import { eqService } from '../../audio/eqService';
import { meterService } from '../../audio/meterService';
import { midiService } from '../../audio/midiService';
import { scopeService, type ScopeMode } from '../../audio/scopeService';
import { recorderService } from '../../audio/recorderService';
import { looperService } from '../../audio/looperService';
import { HEADER_H, ROW_H, hueFor } from '../constants';

import { patterns } from '../../patterns';

const MIDI_KEYS = [
  { note: 60, label: 'A', type: 'white' as const },
  { note: 61, label: 'W', type: 'black' as const },
  { note: 62, label: 'S', type: 'white' as const },
  { note: 63, label: 'E', type: 'black' as const },
  { note: 64, label: 'D', type: 'white' as const },
  { note: 65, label: 'F', type: 'white' as const },
  { note: 66, label: 'T', type: 'black' as const },
  { note: 67, label: 'G', type: 'white' as const },
  { note: 68, label: 'Y', type: 'black' as const },
  { note: 69, label: 'H', type: 'white' as const },
  { note: 70, label: 'U', type: 'black' as const },
  { note: 71, label: 'J', type: 'white' as const },
  { note: 72, label: 'K', type: 'white' as const },
];

export type PinTableNodeType = Node<{ pl: true }, 'pinTable'>;

function applySeqPreset(nodeId: string, name: string) {
  const setBulk = useApp.getState().setParamsBulk;
  const p: Record<string, number> = {};
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= 16; c++) {
      p[`s${r}_${c}`] = 0;
    }
  }

  if (name === 'Clear') {
    setBulk(nodeId, p, { pattern: '' });
  } else {
    const pattern = patterns.find(pat => pat.name === name || pat.id === name);
    if (pattern) {
      p.steps = pattern.steps;
      p.rate = pattern.rate;
      for (let r = 0; r < pattern.rows.length; r++) {
        for (let c = 0; c < pattern.rows[r].length; c++) {
          p[`s${r + 1}_${c + 1}`] = pattern.rows[r][c];
        }
      }
      setBulk(nodeId, p, { pattern: pattern.id });
    } else {
      setBulk(nodeId, p);
    }
  }

  // Show toast
  const showToast = useApp.getState().showToast;
  const displayName = name === 'Clear' ? 'Clear' : (patterns.find(pat => pat.name === name || pat.id === name)?.name || name);
  showToast(`${displayName} loaded`);
}

function getLoopPointerInfo(
  nodeId: string,
  canvas: HTMLCanvasElement,
  clientX: number,
  pointerType: string,
) {
  const region = looperService.getRegion(nodeId);
  if (!region || region.duration <= 0) return null;

  const rect = canvas.getBoundingClientRect();
  const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
  const seconds = (x / rect.width) * region.duration;
  const startX = (region.start / region.duration) * rect.width;
  const endX = (region.end / region.duration) * rect.width;
  const grab = pointerType === 'touch' || pointerType === 'pen' ? 24 : 8;
  const startDist = Math.abs(x - startX);
  const endDist = Math.abs(x - endX);
  const handle =
    Math.min(startDist, endDist) <= grab
      ? startDist <= endDist
        ? 'start'
        : 'end'
      : null;

  return { ...region, seconds, handle };
}

type EqBandId = 'ls' | 'b1' | 'b2' | 'hs';

type EqBandControl = {
  id: EqBandId;
  freqParam: string;
  gainParam: string;
  qParam?: string;
};

const EQ_BANDS: EqBandControl[] = [
  { id: 'ls', freqParam: 'lsFreq', gainParam: 'lsGain' },
  { id: 'b1', freqParam: 'b1Freq', gainParam: 'b1Gain', qParam: 'b1Q' },
  { id: 'b2', freqParam: 'b2Freq', gainParam: 'b2Gain', qParam: 'b2Q' },
  { id: 'hs', freqParam: 'hsFreq', gainParam: 'hsGain' },
];

const EQ_FREQ_MIN = 20;
const EQ_FREQ_MAX = 20000;
const EQ_GAIN_MIN = -18;
const EQ_GAIN_MAX = 18;

const freqToX = (freq: number, width: number) =>
  (Math.log(freq / EQ_FREQ_MIN) / Math.log(EQ_FREQ_MAX / EQ_FREQ_MIN)) * width;

const xToFreq = (x: number, width: number) =>
  EQ_FREQ_MIN * Math.pow(EQ_FREQ_MAX / EQ_FREQ_MIN, clamp(x / width, 0, 1));

const gainToY = (gain: number, height: number) =>
  ((EQ_GAIN_MAX - clamp(gain, EQ_GAIN_MIN, EQ_GAIN_MAX)) / (EQ_GAIN_MAX - EQ_GAIN_MIN)) * height;

const yToGain = (y: number, height: number) =>
  EQ_GAIN_MAX - clamp(y / height, 0, 1) * (EQ_GAIN_MAX - EQ_GAIN_MIN);

const paramById = (spec: ComponentSpec, paramId: string): ParamSpec | undefined =>
  spec.params.find((p) => p.id === paramId);

function buildEqBandParams(
  node: NodeInstance,
  activeBandId?: EqBandId | null,
) {
  if (node.type !== 'peq4') return { bands: [], activeBandId: null };
  return {
    activeBandId: activeBandId ?? null,
    bands: EQ_BANDS.map((band) => ({
      id: band.id,
      freq: node.params[band.freqParam] ?? 0,
      gain: node.params[band.gainParam] ?? 0,
    })),
  };
}

function getEqBandHit(
  node: NodeInstance,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  pointerType: string,
) {
  if (node.type !== 'peq4') return null;

  const rect = canvas.getBoundingClientRect();
  const x = clamp(clientX - rect.left, 0, rect.width);
  const y = clamp(clientY - rect.top, 0, rect.height);
  const grab = pointerType === 'touch' || pointerType === 'pen' ? 24 : 12;
  let best: { band: EqBandControl; dist: number } | null = null;

  for (const band of EQ_BANDS) {
    const bx = freqToX(node.params[band.freqParam] ?? 0, rect.width);
    const by = gainToY(node.params[band.gainParam] ?? 0, rect.height);
    const dist = Math.hypot(x - bx, y - by);
    if (dist <= grab && (!best || dist < best.dist)) {
      best = { band, dist };
    }
  }

  return best?.band ?? null;
}

function PinTableNodeImpl({ id }: NodeProps<PinTableNodeType>) {
  const node = useApp((s) => s.design.nodes.find((n) => n.id === id));
  const selected = useApp((s) => s.ui.selectedNodeIds.includes(id));
  const trace = useApp((s) => s.ui.trace);
  const hoverTracePin = useApp((s) => s.hoverTracePin);
  const pinTracePin = useApp((s) => s.pinTracePin);
  const loadMediaFile = useApp((s) => s.loadMediaFile);
  const fileRef = useRef<HTMLInputElement>(null);

  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => meterService.attachCanvas(id, el),
    [id],
  );
  const scopeRef = useCallback(
    (el: HTMLCanvasElement | null) => scopeService.attachCanvas(id, el),
    [id],
  );
  const eqRef = useCallback(
    (el: HTMLCanvasElement | null) => eqService.attachCanvas(id, el),
    [id],
  );
  const loopWaveRef = useCallback(
    (el: HTMLCanvasElement | null) => looperService.attachLoopCanvas(id, el),
    [id],
  );
  const seqRef = useRef<HTMLDivElement>(null);
  const recTimeRef = useRef<HTMLSpanElement>(null);
  const loopTimeRef = useRef<HTMLSpanElement>(null);
  const midiActivityRef = useRef<HTMLSpanElement>(null);
  const keyboardRef = useRef<HTMLDivElement>(null);
  const loopDragRef = useRef<{ pointerId: number; handle: 'start' | 'end' } | null>(null);
  const loopDragLastRef = useRef(0);
  const eqDragRef = useRef<{ pointerId: number; band: EqBandControl } | null>(null);
  const eqDragLastRef = useRef(0);

  const [recState, setRecState] = React.useState<{ state: string, startedAt: number, lastTakeSeconds: number }>({ state: 'idle', startedAt: 0, lastTakeSeconds: 0 });
  const [loopState, setLoopState] = React.useState<{ state: string, startedAt: number, hasLoop: boolean, bufferVersion: number }>({ state: 'empty', startedAt: 0, hasLoop: false, bufferVersion: 0 });
  const [midiVersion, setMidiVersion] = React.useState(0);
  const spec = node ? registry[node.type] : undefined;
  const midiStatus = React.useMemo(() => midiService.getStatus(), [midiVersion]);

  const applyEqDrag = useCallback(
    (canvas: HTMLCanvasElement, clientX: number, clientY: number, band: EqBandControl) => {
      if (!node || !spec) return;
      const rect = canvas.getBoundingClientRect();
      const freqSpec = paramById(spec, band.freqParam);
      const gainSpec = paramById(spec, band.gainParam);
      if (!freqSpec || !gainSpec) return;

      const x = clamp(clientX - rect.left, 0, rect.width);
      const y = clamp(clientY - rect.top, 0, rect.height);
      const nextFreq = clamp(
        roundToStep(xToFreq(x, rect.width), freqSpec.step),
        freqSpec.min,
        freqSpec.max,
      );
      const nextGain = clamp(
        roundToStep(yToGain(y, rect.height), gainSpec.step),
        gainSpec.min,
        gainSpec.max,
      );
      const app = useApp.getState();
      app.setParam(id, band.freqParam, nextFreq);
      app.setParam(id, band.gainParam, nextGain);
      eqService.setBandParams(id, {
        ...buildEqBandParams({
          ...node,
          params: {
            ...node.params,
            [band.freqParam]: nextFreq,
            [band.gainParam]: nextGain,
          },
        }, band.id),
      });
      eqService.markDirty(id);
    },
    [id, node, spec],
  );

  const onEqPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.stopPropagation();
      if (!node || !spec || node.type !== 'peq4') return;
      const band = getEqBandHit(node, e.currentTarget, e.clientX, e.clientY, e.pointerType);
      if (!band) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      eqDragRef.current = { pointerId: e.pointerId, band };
      eqDragLastRef.current = 0;
      eqService.setBandParams(id, buildEqBandParams(node, band.id));
    },
    [id, node, spec],
  );

  const onEqPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = eqDragRef.current;
      if (!drag) {
        const band = node ? getEqBandHit(node, e.currentTarget, e.clientX, e.clientY, e.pointerType) : null;
        e.currentTarget.style.cursor = band ? 'grab' : 'default';
        return;
      }
      if (drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.style.cursor = 'grabbing';
      const now = performance.now();
      if (now - eqDragLastRef.current < 33) return;
      eqDragLastRef.current = now;
      applyEqDrag(e.currentTarget, e.clientX, e.clientY, drag.band);
    },
    [applyEqDrag, node],
  );

  const onEqPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = eqDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      applyEqDrag(e.currentTarget, e.clientX, e.clientY, drag.band);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { }
      eqDragRef.current = null;
      if (node) eqService.setBandParams(id, buildEqBandParams(node, null));
      const band = node ? getEqBandHit(node, e.currentTarget, e.clientX, e.clientY, e.pointerType) : null;
      e.currentTarget.style.cursor = band ? 'grab' : 'default';
    },
    [applyEqDrag, id, node],
  );

  const onEqWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!node || !spec || node.type !== 'peq4') return;
      const band = getEqBandHit(node, e.currentTarget, e.clientX, e.clientY, 'mouse');
      if (!band?.qParam) return;
      const qSpec = paramById(spec, band.qParam);
      if (!qSpec) return;
      e.preventDefault();
      e.stopPropagation();
      const current = node.params[band.qParam] ?? qSpec.default;
      const scaled = e.deltaY < 0 ? current * 1.12 : current / 1.12;
      const next = clamp(roundToStep(scaled, qSpec.step), qSpec.min, qSpec.max);
      useApp.getState().setParam(id, band.qParam, next);
      eqService.setBandParams(id, buildEqBandParams(node, band.id));
      eqService.markDirty(id);
    },
    [id, node, spec],
  );

  const applyLoopDrag = useCallback(
    (canvas: HTMLCanvasElement, clientX: number, pointerType: string, handle: 'start' | 'end') => {
      const info = getLoopPointerInfo(id, canvas, clientX, pointerType);
      if (!info) return;
      looperService.setRegion(
        id,
        handle === 'start' ? info.seconds : info.start,
        handle === 'end' ? info.seconds : info.end,
      );
    },
    [id],
  );

  const onLoopPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.stopPropagation();
      const info = getLoopPointerInfo(id, e.currentTarget, e.clientX, e.pointerType);
      if (!info?.handle) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      loopDragRef.current = { pointerId: e.pointerId, handle: info.handle as 'start' | 'end' };
      loopDragLastRef.current = 0;
    },
    [id],
  );

  const onLoopPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = loopDragRef.current;
      if (!drag) {
        const info = getLoopPointerInfo(id, e.currentTarget, e.clientX, e.pointerType);
        e.currentTarget.style.cursor = info?.handle ? 'ew-resize' : 'default';
        return;
      }
      if (drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - loopDragLastRef.current < 33) return;
      loopDragLastRef.current = now;
      applyLoopDrag(e.currentTarget, e.clientX, e.pointerType, drag.handle);
    },
    [applyLoopDrag, id],
  );

  const onLoopPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = loopDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      applyLoopDrag(e.currentTarget, e.clientX, e.pointerType, drag.handle);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { }
      loopDragRef.current = null;
      const info = getLoopPointerInfo(id, e.currentTarget, e.clientX, e.pointerType);
      e.currentTarget.style.cursor = info?.handle ? 'ew-resize' : 'default';
    },
    [applyLoopDrag, id],
  );

  const conn = useConnection();
  const wires = useApp((s) => s.design.wires);
  const designNodes = useApp((s) => s.design.nodes);
  const activeLayerId = useApp((s) => s.ui.activeLayerId);
  const layers = useApp((s) => s.design.layers ?? [{ id: 'main', name: 'Main' }]);
  const firstLayerId = layers[0]?.id ?? 'main';

  const fromSpec = React.useMemo(() => {
    if (!conn.inProgress || !conn.fromHandle) return null;
    const fromType = designNodes.find(n => n.id === conn.fromHandle!.nodeId)?.type;
    return fromType ? registry[fromType]?.pins.find(p => p.id === conn.fromHandle!.id) : null;
  }, [conn.inProgress, conn.fromHandle, designNodes]);

  const takenInputs = React.useMemo(() => {
    if (!conn.inProgress) return new Set<string>();
    const set = new Set<string>();
    for (const w of wires) set.add(`${w.to.nodeId}:${w.to.pinId}`);
    return set;
  }, [conn.inProgress, wires]);

  React.useEffect(() => {
    if (spec?.display !== 'sequencer') return;

    const onStep = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail.nodeId !== id) return;
      const grid = seqRef.current;
      if (!grid) return;

      setTimeout(() => {
        const prev = grid.querySelectorAll('.is-playhead');
        prev.forEach(el => el.classList.remove('is-playhead'));
        const cells = grid.querySelectorAll(`[data-col="${ce.detail.step}"]`);
        cells.forEach(el => el.classList.add('is-playhead'));
      }, ce.detail.delayMs);
    };

    const onStop = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail.nodeId !== id) return;
      const grid = seqRef.current;
      if (!grid) return;
      const prev = grid.querySelectorAll('.is-playhead');
      prev.forEach(el => el.classList.remove('is-playhead'));
    };

    window.addEventListener('pl-seq-step', onStep);
    window.addEventListener('pl-seq-stop', onStop);
    return () => {
      window.removeEventListener('pl-seq-step', onStep);
      window.removeEventListener('pl-seq-stop', onStop);
    };
  }, [id, spec?.display]);

  const activePattern = React.useMemo(() => {
    if (!node || !spec || spec.display !== 'sequencer' || !node.meta?.pattern) return null;
    const pat = patterns.find(p => p.id === node.meta?.pattern);
    if (!pat) return null;
    let edited = false;
    if ((node.params.steps || 16) !== pat.steps) edited = true;
    if ((node.params.rate || 0) !== pat.rate) edited = true;
    if (!edited) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 16; c++) {
          const expected = (pat.rows[r]?.[c] === 1) ? 1 : 0;
          const actual = (node.params[`s${r + 1}_${c + 1}`] || 0) > 0.5 ? 1 : 0;
          if (expected !== actual) {
            edited = true;
            break;
          }
        }
        if (edited) break;
      }
    }
    return { pat, edited };
  }, [spec?.display, node?.meta?.pattern, node?.params]);

  React.useEffect(() => {
    if (spec?.display === 'recorder') {
      const unsub = recorderService.onState(id, (state, startedAt, lastTakeSeconds) => {
        setRecState({ state, startedAt, lastTakeSeconds });
      });
      return () => { unsub(); };
    }
  }, [id, spec?.display]);

  React.useEffect(() => {
    if (recState.state !== 'recording') return;
    const timer = setInterval(() => {
      if (recTimeRef.current) {
        const s = Math.round((Date.now() - recState.startedAt) / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        recTimeRef.current.textContent = `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
      }
    }, 500);
    return () => clearInterval(timer);
  }, [recState.state, recState.startedAt]);

  React.useEffect(() => {
    if (spec?.display === 'looper') {
      const unsub = looperService.onState(id, (state, startedAt, hasLoop, bufferVersion) => {
        setLoopState({ state, startedAt, hasLoop, bufferVersion });
      });
      return () => { unsub(); };
    }
  }, [id, spec?.display]);

  React.useEffect(() => {
    if (loopState.state !== 'recording') return;
    const timer = setInterval(() => {
      if (loopTimeRef.current) {
        const s = Math.round((Date.now() - loopState.startedAt) / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        loopTimeRef.current.textContent = `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
      }
    }, 500);
    return () => clearInterval(timer);
  }, [loopState.state, loopState.startedAt]);

  React.useEffect(() => {
    if (spec?.display !== 'midi') return;
    return midiService.subscribe(() => setMidiVersion((v) => v + 1));
  }, [spec?.display]);

  React.useEffect(() => {
    if (spec?.display !== 'midi') return;
    let timer: number | undefined;
    const onNote = (e: Event) => {
      const ce = e as CustomEvent<{ nodeId: string, note?: number }>;
      if (ce.detail?.nodeId !== id) return;
      const dot = midiActivityRef.current;
      if (dot) {
        window.clearTimeout(timer);
        dot.classList.add('is-active');
        timer = window.setTimeout(() => dot.classList.remove('is-active'), 120);
      }
      if (ce.detail.note !== undefined && keyboardRef.current) {
        const keyEl = keyboardRef.current.querySelector(`[data-note="${ce.detail.note}"]`);
        if (keyEl) {
          keyEl.classList.add('is-active');
          const timerId = Number(keyEl.getAttribute('data-timer'));
          if (timerId) window.clearTimeout(timerId);
          const newTimer = window.setTimeout(() => keyEl.classList.remove('is-active'), 120);
          keyEl.setAttribute('data-timer', newTimer.toString());
        }
      }
    };

    window.addEventListener('pl-midi-note', onNote);
    return () => {
      window.removeEventListener('pl-midi-note', onNote);
      window.clearTimeout(timer);
    };
  }, [id, spec?.display]);

  const crossLayerTargets = React.useMemo(() => {
    const targets = new Map<string, string>();
    if (activeLayerId === 'all') return targets;

    const nodeLayers = new Map<string, string>();
    for (const n of designNodes) {
      nodeLayers.set(n.id, n.layerId ?? firstLayerId);
    }

    const layerNames = new Map<string, string>();
    for (const l of layers) {
      layerNames.set(l.id, l.name);
    }

    for (const w of wires) {
      if (w.from.nodeId === id || w.to.nodeId === id) {
        const isOut = w.from.nodeId === id;
        const pinId = isOut ? w.from.pinId : w.to.pinId;
        const otherId = isOut ? w.to.nodeId : w.from.nodeId;

        const otherLayerId = nodeLayers.get(otherId);
        if (otherLayerId && otherLayerId !== activeLayerId) {
          targets.set(pinId, layerNames.get(otherLayerId) ?? 'Other Layer');
        }
      }
    }
    return targets;
  }, [wires, designNodes, activeLayerId, layers, firstLayerId, id]);

  if (!node || !spec) return null;

  if (spec.display === 'scope') {
    scopeService.setMode(id, (Math.round(node.params.mode ?? 0) as ScopeMode) || 0);
  }

  if (spec.display === 'eq') {
    eqService.setBandParams(id, buildEqBandParams(node, eqDragRef.current?.band.id ?? null));
    eqService.markDirty(id);
  }

  const onPath = trace?.nodes.has(id) ?? false;
  const hue = trace ? hueFor(trace.hueIndex) : undefined;
  const midiStatusLine =
    midiStatus.state === 'unavailable'
      ? 'Web MIDI unavailable - computer keys only'
      : midiStatus.state === 'enabled'
        ? `MIDI: ${midiStatus.inputCount} inputs`
        : 'MIDI: not enabled';
  const computerKeysOn = (node.params.computer ?? 0) > 0.5;

  const inPins = spec.pins.filter((p) => p.direction === 'in');
  const outPins = spec.pins.filter((p) => p.direction === 'out');

  return (
    <div
      className={[
        'pl-node',
        spec.display === 'sequencer' ? 'is-seq' : '',
        selected ? 'is-selected' : '',
        onPath ? 'on-path' : '',
      ].join(' ')}
    >
      <div className="pl-node__header" style={{ height: HEADER_H }}>
        <span className="pl-node__title">{node.label}</span>
        <canvas
          ref={canvasRef}
          className="pl-meter"
          width={88}
          height={16}
          aria-label="level meter"
        />
      </div>

      {spec.pins.map((pin) => {
        const traced = trace?.pins.has(pinKey({ nodeId: id, pinId: pin.id }));
        const isIn = pin.direction === 'in';
        const isControl = pin.kind === 'control';
        const isTrigger = pin.kind === 'trigger';
        const idx = isIn
          ? inPins.indexOf(pin) + 1
          : outPins.indexOf(pin) + 1;

        let hintClass = '';
        if (conn.inProgress && fromSpec) {
          const isValidTarget =
            conn.fromHandle!.nodeId !== id &&
            fromSpec.direction !== pin.direction &&
            fromSpec.kind === pin.kind &&
            (!isIn || !takenInputs.has(`${id}:${pin.id}`));
          hintClass = isValidTarget ? 'is-valid-target' : 'is-dim';
        }

        const crossLayerName = crossLayerTargets.get(pin.id);

        return (
          <div
            key={pin.id}
            className={['pl-pinrow', isIn ? 'is-in' : 'is-out'].join(' ')}
            style={{ height: ROW_H }}
            onMouseEnter={() => hoverTracePin({ nodeId: id, pinId: pin.id })}
            onMouseLeave={() => hoverTracePin(null)}
            onClick={(e) => {
              e.stopPropagation();
              pinTracePin({ nodeId: id, pinId: pin.id });
              useApp.getState().setSelectedNodes([id]);
            }}
          >
            <span className="pl-pinrow__index">{idx}</span>
            <span className="pl-pinrow__label">{pin.label}</span>
            <Handle
              id={pin.id}
              type={isIn ? 'target' : 'source'}
              position={isIn ? Position.Left : Position.Right}
              className={[
                'pl-handle',
                traced ? 'is-traced' : '',
                isControl ? 'is-control' : '',
                isTrigger ? 'is-trigger' : '',
                crossLayerName ? 'is-crosslayer' : '',
                hintClass,
              ].join(' ')}
              style={
                { '--pl-pin-hue': traced ? hue : undefined } as CSSProperties
              }
              title={crossLayerName ? `→ ${crossLayerName}` : undefined}
              onMouseEnter={() =>
                hoverTracePin({ nodeId: id, pinId: pin.id })
              }
              onMouseLeave={() => hoverTracePin(null)}
              onClick={(e) => {
                e.stopPropagation();
                pinTracePin({ nodeId: id, pinId: pin.id });
              }}
            />
          </div>
        );
      })}

      {spec.display === 'scope' && (
        <canvas
          ref={scopeRef}
          className="pl-scope"
          width={368}
          height={144}
          aria-label="signal display"
        />
      )}

      {spec.display === 'eq' && (
        <canvas
          ref={eqRef}
          className="pl-eqcurve nodrag"
          width={368}
          height={168}
          aria-label="EQ response and spectrum"
          onPointerDown={onEqPointerDown}
          onPointerMove={onEqPointerMove}
          onPointerUp={onEqPointerUp}
          onPointerCancel={onEqPointerUp}
          onWheel={onEqWheel}
        />
      )}

      {spec.display === 'media' && (
        <div className="pl-node__extra">
          <button
            className="pl-mini-btn nodrag"
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
          >
            Load file…
          </button>
          <span className="pl-node__file" title={node.meta?.file}>
            {node.meta?.file ?? 'no file loaded'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadMediaFile(id, f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {spec.display === 'mic' && (
        <div className="pl-node__extra pl-node__hint">
          Enable asks the browser for mic access
        </div>
      )}

      {spec.display === 'trigger' && (
        <div style={{ padding: '8px' }}>
          <button
            className="pl-pad nodrag"
            style={{ width: '100%', height: '44px' }}
            onPointerDown={(e) => {
              const btn = e.currentTarget;
              btn.classList.add('is-pressed');
              setTimeout(() => btn.classList.remove('is-pressed'), 120);
              useApp.getState().fireTrigger(id, 'out');
            }}
          >
            TRIG
          </button>
        </div>
      )}

      {spec.display === 'midi' && (
        <div className="pl-midi-body">
          <div className="pl-midi-row">
            <span ref={midiActivityRef} className="pl-midi-dot" aria-hidden="true" />
            <span className="pl-midi-status" title={midiStatusLine}>
              {midiStatusLine}
            </span>
          </div>
          <div className="pl-midi-controls">
            <button
              className="pl-mini-btn nodrag"
              disabled={midiStatus.state === 'unavailable'}
              onClick={(e) => {
                e.stopPropagation();
                midiService.enable();
              }}
            >
              Enable MIDI
            </button>
            <button
              className={['pl-mini-btn', 'nodrag', computerKeysOn ? 'is-on' : ''].join(' ')}
              aria-pressed={computerKeysOn}
              onClick={(e) => {
                e.stopPropagation();
                useApp.getState().setParam(id, 'computer', computerKeysOn ? 0 : 1);
              }}
            >
              Computer keys
            </button>
          </div>
          <div className="pl-midi-keys nodrag" ref={keyboardRef}>
            {MIDI_KEYS.map((k, index) => {
              if (k.type === 'white') {
                return (
                  <div
                    key={k.note}
                    data-note={k.note}
                    className="pl-midi-key pl-midi-key--white nodrag"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent('pl-midi-pointer-note', {
                          detail: { nodeId: id, note: k.note, velocity: 0.79 },
                        }),
                      );
                    }}
                  >
                    <span className="pl-midi-key-label">{k.label}</span>
                  </div>
                );
              } else {
                const whiteCount = MIDI_KEYS.slice(0, index).filter((x) => x.type === 'white').length;
                return (
                  <div
                    key={k.note}
                    data-note={k.note}
                    className="pl-midi-key pl-midi-key--black nodrag"
                    style={{ left: `calc(${whiteCount * 12.5}% - 3.75%)` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(
                        new CustomEvent('pl-midi-pointer-note', {
                          detail: { nodeId: id, note: k.note, velocity: 0.79 },
                        }),
                      );
                    }}
                  >
                    <span className="pl-midi-key-label">{k.label}</span>
                  </div>
                );
              }
            })}
          </div>
        </div>
      )}

      {spec.display === 'recorder' && (
        <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            className={`pl-pad nodrag ${recState.state === 'recording' ? 'is-pressed' : ''}`}
            style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            disabled={recState.state === 'unsupported'}
            onPointerDown={(e) => {
              e.stopPropagation();
              const app = useApp.getState();
              if (recState.state === 'idle') {
                app.startRecording(id);
              } else if (recState.state === 'recording') {
                app.stopRecording(id);
              }
            }}
          >
            {recState.state === 'unsupported' ? (
              <span>Not Supported</span>
            ) : recState.state === 'recording' ? (
              <>
                <span style={{ fontSize: '10px' }}>■</span>
                <span>STOP</span>
                <span ref={recTimeRef} style={{ fontVariantNumeric: 'tabular-nums', marginLeft: '4px' }}>00:00</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: '12px' }}>○</span>
                <span>REC</span>
              </>
            )}
          </button>
          {recState.state !== 'recording' && recState.lastTakeSeconds > 0 && (
            <div style={{ fontSize: '10px', color: 'var(--text-disabled)', textAlign: 'center' }}>
              last take {Math.floor(recState.lastTakeSeconds / 60).toString().padStart(2, '0')}:{(recState.lastTakeSeconds % 60).toString().padStart(2, '0')}
            </div>
          )}
        </div>
      )}

      {spec.display === 'looper' && (
        <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className={`pl-pad nodrag ${loopState.state === 'recording' ? 'is-pressed' : ''}`}
              style={{ flex: 1, height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                useApp.getState().looperAction(id, (node.params.sync ?? 1) > 0.5);
              }}
            >
              {loopState.state === 'empty' ? (
                <>
                  <span style={{ fontSize: '12px' }}>○</span>
                  <span>REC</span>
                </>
              ) : loopState.state === 'recording' ? (
                <>
                  <span style={{ fontSize: '10px' }}>■</span>
                  <span>STOP</span>
                </>
              ) : loopState.state === 'playing' ? (
                <>
                  <span style={{ fontSize: '10px' }}>■</span>
                  <span>STOP</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '12px' }}>▶</span>
                  <span>PLAY</span>
                </>
              )}
            </button>
            <button
              className="pl-pad nodrag"
              style={{ width: '44px', height: '44px' }}
              disabled={loopState.state === 'empty' || loopState.state === 'recording'}
              onPointerDown={(e) => {
                e.stopPropagation();
                useApp.getState().looperClear(id);
              }}
            >
              CLR
            </button>
          </div>
          {loopState.hasLoop && (
            <>
              <canvas
                ref={loopWaveRef}
                className="pl-loopwave nodrag"
                width={368}
                height={112}
                aria-label="loop waveform"
                onPointerDown={onLoopPointerDown}
                onPointerMove={onLoopPointerMove}
                onPointerUp={onLoopPointerUp}
                onPointerCancel={onLoopPointerUp}
              />
              <div className="pl-loopchips">
                <button
                  className="pl-mini-btn nodrag"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    looperService.normalize(id);
                  }}
                >
                  Normalize
                </button>
                <button
                  className="pl-mini-btn nodrag"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    looperService.reverse(id);
                  }}
                >
                  Reverse
                </button>
              </div>
            </>
          )}
          <div style={{ fontSize: '10px', color: loopState.state === 'recording' ? 'var(--danger)' : 'var(--text-disabled)', textAlign: 'center', height: '12px' }}>
            {loopState.state === 'empty' && 'empty'}
            {loopState.state === 'recording' && (
              <>recording... <span ref={loopTimeRef} style={{ fontVariantNumeric: 'tabular-nums' }}>00:00</span></>
            )}
            {loopState.state === 'playing' && 'playing'}
            {loopState.state === 'stopped' && 'stopped'}
          </div>
        </div>
      )}

      {spec.display === 'sequencer' && (
        <div className="pl-seq-block" ref={seqRef}>
          <div className="pl-seq-grid">
            {['D', 'T', 'K', 'G'].map((rowLabel, r) => (
              <div key={r} className="pl-seq-row">
                <span className="pl-seq-row-label">{rowLabel}</span>
                {Array.from({ length: 16 }).map((_, c) => {
                  const paramId = `s${r + 1}_${c + 1}`;
                  const on = (node.params[paramId] || 0) > 0.5;
                  const active = c < (node.params.steps || 16);
                  return (
                    <button
                      key={c}
                      data-col={c}
                      className={[
                        'pl-seq-cell',
                        'nodrag',
                        on ? 'is-on' : '',
                        !active ? 'is-inactive' : '',
                        c % 4 === 0 ? 'is-beat' : ''
                      ].join(' ')}
                      onClick={(e) => {
                        e.stopPropagation();
                        useApp.getState().setParam(id, paramId, on ? 0 : 1);
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {activePattern && (
            <div style={{ padding: '0 8px 8px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {activePattern.pat.name}{activePattern.edited ? ' · edited' : ''}
              </span>
              {activePattern.edited && (
                <button
                  className="pl-mini-btn nodrag"
                  onClick={(e) => {
                    e.stopPropagation();
                    applySeqPreset(id, activePattern.pat.id);
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          )}
          <div className="pl-seq-presets">
            {['Maqsum', 'Baladi', 'Saidi', 'Malfuf', "Sama\u02bfi Thaqil", 'Clear'].map(preset => (
              <button
                key={preset}
                className="pl-mini-btn nodrag"
                onClick={(e) => {
                  e.stopPropagation();
                  applySeqPreset(id, preset);
                }}
              >
                {preset}
              </button>
            ))}
            <button
              className="pl-mini-btn nodrag"
              onClick={(e) => {
                e.stopPropagation();
                const s = useApp.getState();
                s.setPanelOpen(true);
                s.setPanelTab('patterns');
              }}
            >
              More …
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const PinTableNode = memo(PinTableNodeImpl);
