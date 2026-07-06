import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/store';
import { midiService } from '../audio/midiService';
import { DIVISION_OPTIONS, divisionFor, syncedValue } from '../audio/sync';
import type { ParamSpec } from '../lib/types';
import {
  clamp,
  formatValue,
  fromNorm,
  roundToStep,
  toNorm,
} from '../lib/units';

const DRAG_THRESHOLD_PX = 3;
const DRAG_FULL_RANGE_PX = 150;
const WHEEL_BURST_MS = 250;

const decimalsForStep = (step: number) => {
  const text = step.toString();
  if (!text.includes('.')) return 0;
  return text.split('.')[1]?.length ?? 0;
};

const displayNumber = (value: number, step: number) =>
  Number(value.toFixed(Math.min(6, decimalsForStep(step)))).toString();

/** locked-field readout: resolved value in the param's unit, e.g. `2.00 Hz` / `300 ms` */
const displaySynced = (value: number, spec: ParamSpec) =>
  spec.sync?.kind === 'hz' ? `${value.toFixed(2)} Hz` : `${Math.round(value)} ms`;

type NumberDragState = {
  pointerId: number;
  startY: number;
  startNorm: number;
  dragging: boolean;
  startedGesture: boolean;
  previousUserSelect: string;
  previousCursor: string;
};

export function ParamField({
  nodeId,
  spec,
  value,
}: {
  nodeId: string;
  spec: ParamSpec;
  value: number;
}) {
  const setParam = useApp((s) => s.setParam);
  const beginParamGesture = useApp((s) => s.beginParamGesture);
  const setParamLive = useApp((s) => s.setParamLive);
  const finishParamGesture = useApp((s) => s.finishParamGesture);
  const divParamId = `${spec.id}_div`;
  const divValue = useApp((s) => {
    if (!spec.sync) return 0;
    const n = s.design.nodes.find((nd) => nd.id === nodeId);
    return Math.round(n?.params[divParamId] ?? 0);
  });
  const sessionSync = useApp((s) => s.design.settings?.sync ?? false);
  const bpm = useApp((s) => s.transport.bpm);
  const [stagedValue, setStagedValue] = useState<string | null>(null);
  const valueRef = useRef(value);
  const dragRef = useRef<NumberDragState | null>(null);
  const wheelActiveRef = useRef(false);
  const wheelTimerRef = useRef<number | undefined>();
  const sliderGestureRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      window.clearTimeout(wheelTimerRef.current);
      if (wheelActiveRef.current) finishParamGesture(nodeId, spec.id);
      const drag = dragRef.current;
      if (drag?.dragging) {
        document.body.style.userSelect = drag.previousUserSelect;
        document.body.style.cursor = drag.previousCursor;
      }
    };
  }, [finishParamGesture, nodeId, spec.id]);

  const taper = spec.taper ?? 'lin';

  // effective sync state: non-null division = locked to tempo, value resolved
  const division = spec.sync ? divisionFor(divValue, spec, sessionSync) : null;
  const locked = division !== null;
  const shownValue = division ? syncedValue(spec, division.beats, bpm) : value;
  const norm = toNorm(shownValue, spec.min, spec.max, taper);

  const sanitize = (v: number, step = spec.step) =>
    clamp(roundToStep(v, step), spec.min, spec.max);

  const commit = (v: number) => {
    const next = sanitize(v);
    valueRef.current = next;
    setParam(nodeId, spec.id, next);
  };

  const commitLive = (v: number, step = spec.step) => {
    const next = sanitize(v, step);
    valueRef.current = next;
    setParamLive(nodeId, spec.id, next);
  };

  const reset = () => {
    if (locked) return;
    setStagedValue(null);
    commit(spec.default);
  };

  const restoreBodyDragStyles = () => {
    const drag = dragRef.current;
    if (!drag?.dragging) return;
    document.body.style.userSelect = drag.previousUserSelect;
    document.body.style.cursor = drag.previousCursor;
  };

  const finishDrag = () => {
    const drag = dragRef.current;
    if (drag?.startedGesture) finishParamGesture(nodeId, spec.id);
    restoreBodyDragStyles();
    dragRef.current = null;
  };

  const stepValue = (direction: number, fine: boolean) => {
    const step = fine ? spec.step * 0.1 : spec.step;
    return sanitize(valueRef.current + direction * step, step);
  };

  return (
    <div className="pl-param pl-param--field">
      <span
        className="pl-param__label"
        title="Double-click to reset"
        onDoubleClick={reset}
      >
        {spec.label}
      </span>
      <input
        className="pl-param__slider"
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(norm * 1000)}
        disabled={locked}
        onPointerDown={() => {
          beginParamGesture(nodeId, spec.id);
          sliderGestureRef.current = true;
        }}
        onPointerUp={() => {
          if (sliderGestureRef.current) finishParamGesture(nodeId, spec.id);
          sliderGestureRef.current = false;
        }}
        onPointerCancel={() => {
          if (sliderGestureRef.current) finishParamGesture(nodeId, spec.id);
          sliderGestureRef.current = false;
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          reset();
        }}
        onChange={(e) => {
          const next = fromNorm(Number(e.target.value) / 1000, spec.min, spec.max, taper);
          if (sliderGestureRef.current) commitLive(next);
          else commit(next);
        }}
        aria-label={spec.label}
      />
      {locked && division ? (
        <span
          className="pl-param__locked"
          title="Synced to tempo — set the division to Free to edit"
        >
          {displaySynced(shownValue, spec)} · {division.label}
        </span>
      ) : (
      <input
        className="pl-param__number"
        type="text"
        value={stagedValue !== null ? stagedValue : displayNumber(value, spec.step)}
        onChange={(e) => setStagedValue(e.target.value)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = {
            pointerId: e.pointerId,
            startY: e.clientY,
            startNorm: norm,
            dragging: false,
            startedGesture: false,
            previousUserSelect: document.body.style.userSelect,
            previousCursor: document.body.style.cursor,
          };
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          const dy = drag.startY - e.clientY;
          if (!drag.dragging) {
            if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
            drag.dragging = true;
            drag.startedGesture = true;
            beginParamGesture(nodeId, spec.id);
            setStagedValue(null);
            e.currentTarget.blur();
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'ns-resize';
          }
          e.preventDefault();
          e.stopPropagation();
          const sensitivity = e.shiftKey ? DRAG_FULL_RANGE_PX * 10 : DRAG_FULL_RANGE_PX;
          const nextNorm = clamp(drag.startNorm + dy / sensitivity, 0, 1);
          commitLive(fromNorm(nextNorm, spec.min, spec.max, taper));
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
          if (drag.dragging) {
            e.preventDefault();
            e.stopPropagation();
            finishDrag();
          } else {
            dragRef.current = null;
            e.currentTarget.focus();
            e.currentTarget.select();
          }
        }}
        onPointerCancel={(e) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
          finishDrag();
        }}
        onWheel={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!wheelActiveRef.current) {
            beginParamGesture(nodeId, spec.id);
            wheelActiveRef.current = true;
          }
          const direction = e.deltaY < 0 ? 1 : -1;
          commitLive(stepValue(direction, e.shiftKey), e.shiftKey ? spec.step * 0.1 : spec.step);
          window.clearTimeout(wheelTimerRef.current);
          wheelTimerRef.current = window.setTimeout(() => {
            finishParamGesture(nodeId, spec.id);
            wheelActiveRef.current = false;
          }, WHEEL_BURST_MS);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          reset();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setStagedValue(null);
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setStagedValue(null);
            setParam(nodeId, spec.id, stepValue(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey));
          }
        }}
        onBlur={() => {
          if (stagedValue !== null) {
            const v = Number(stagedValue);
            if (stagedValue.trim() === '' || !Number.isFinite(v)) {
              setStagedValue(null);
            } else {
              commit(v);
              setStagedValue(null);
            }
          }
        }}
        title={formatValue(value, spec.unit, spec.step)}
        aria-label={`${spec.label} value`}
      />
      )}
      {spec.sync && (
        <select
          className="pl-param__div"
          value={divValue}
          onChange={(e) => setParam(nodeId, divParamId, Number(e.target.value))}
          aria-label={`${spec.label} sync division`}
          title="Tempo sync — Auto follows the session Sync switch"
        >
          {DIVISION_OPTIONS.map((label, i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ParamControl({
  nodeId,
  spec,
  value,
}: {
  nodeId: string;
  spec: ParamSpec;
  value: number;
}) {
  const setParam = useApp((s) => s.setParam);
  const [, setOptionVersion] = useState(0);

  useEffect(() => {
    if (spec.dynamicOptions !== 'midiInputs') return;
    return midiService.subscribe(() => setOptionVersion((v) => v + 1));
  }, [spec.dynamicOptions]);

  const options =
    spec.dynamicOptions === 'midiInputs'
      ? midiService.getDeviceOptions()
      : spec.options;

  if (spec.kind === 'select' && options) {
    const idx = clamp(Math.round(value), 0, Math.max(0, options.length - 1));
    if (spec.selectStyle === 'dropdown' || spec.dynamicOptions) {
      return (
        <div className="pl-param">
          <span className="pl-param__label">{spec.label}</span>
          <select
            className="pl-param__number pl-param__select"
            value={idx}
            onChange={(e) => setParam(nodeId, spec.id, Number(e.target.value))}
            aria-label={spec.label}
          >
            {options.map((opt, i) => (
              <option key={`${opt}-${i}`} value={i}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div className="pl-param">
        <span className="pl-param__label">{spec.label}</span>
        <div className="pl-segment" role="radiogroup" aria-label={spec.label}>
          {options.map((opt, i) => (
            <button
              key={opt}
              className={i === idx ? 'is-on' : ''}
              aria-pressed={i === idx}
              onClick={() => setParam(nodeId, spec.id, i)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (spec.kind === 'toggle') {
    const on = value > 0.5;
    return (
      <div className="pl-param">
        <span className="pl-param__label">{spec.label}</span>
        <button
          className={['pl-toggle', on ? 'is-on' : ''].join(' ')}
          aria-pressed={on}
          onClick={() => setParam(nodeId, spec.id, on ? 0 : 1)}
        >
          {on ? 'On' : 'Off'}
        </button>
      </div>
    );
  }

  return <ParamField nodeId={nodeId} spec={spec} value={value} />;
}
