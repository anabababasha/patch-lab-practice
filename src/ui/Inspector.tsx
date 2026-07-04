import { useApp } from '../app/store';
import { registry } from '../components/registry';
import type { ParamSpec } from '../lib/types';
import {
  clamp,
  formatValue,
  fromNorm,
  roundToStep,
  toNorm,
} from '../lib/units';

function ParamControl({
  nodeId,
  spec,
  value,
}: {
  nodeId: string;
  spec: ParamSpec;
  value: number;
}) {
  const setParam = useApp((s) => s.setParam);

  if (spec.kind === 'select' && spec.options) {
    const idx = Math.round(value);
    return (
      <div className="pl-param">
        <span className="pl-param__label">{spec.label}</span>
        <div className="pl-segment" role="radiogroup" aria-label={spec.label}>
          {spec.options.map((opt, i) => (
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

  const taper = spec.taper ?? 'lin';
  const norm = toNorm(value, spec.min, spec.max, taper);

  const commit = (v: number) =>
    setParam(nodeId, spec.id, clamp(roundToStep(v, spec.step), spec.min, spec.max));

  return (
    <div className="pl-param">
      <span
        className="pl-param__label"
        title="Double-click to reset"
        onDoubleClick={() => commit(spec.default)}
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
        onChange={(e) =>
          commit(fromNorm(Number(e.target.value) / 1000, spec.min, spec.max, taper))
        }
        aria-label={spec.label}
      />
      <input
        className="pl-param__number"
        type="number"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Number(value.toFixed(2))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) commit(v);
        }}
        aria-label={`${spec.label} value`}
      />
      <span className="pl-param__value">{formatValue(value, spec.unit)}</span>
    </div>
  );
}

export function Inspector() {
  const selectedNodeIds = useApp((s) => s.ui.selectedNodeIds);
  const nodes = useApp((s) => s.design.nodes);
  const removeNodes = useApp((s) => s.removeNodes);
  const removeNode = useApp((s) => s.removeNode);

  if (selectedNodeIds.length === 0) return null;

  if (selectedNodeIds.length > 1) {
    return (
      <section className="pl-inspector" aria-label="Inspector">
        <div className="pl-inspector__head">
          <span className="pl-inspector__title">{selectedNodeIds.length} components selected</span>
          <button
            className="pl-btn pl-btn--danger"
            onClick={() => removeNodes(selectedNodeIds)}
          >
            Delete all
          </button>
        </div>
      </section>
    );
  }

  const selectedId = selectedNodeIds[0];
  const node = nodes.find((n) => n.id === selectedId);

  if (!node) return null;
  const spec = registry[node.type];
  if (!spec) return null;

  return (
    <section className="pl-inspector" aria-label="Inspector">
      <div className="pl-inspector__head">
        <span className="pl-inspector__title">{node.label}</span>
        <span className="pl-inspector__type">{spec.category}</span>
        <button
          className="pl-btn pl-btn--danger"
          onClick={() => removeNode(node.id)}
        >
          Delete
        </button>
      </div>
      <div className="pl-inspector__params">
        {spec.params.map((p) => (
          <ParamControl
            key={p.id}
            nodeId={node.id}
            spec={p}
            value={node.params[p.id] ?? p.default}
          />
        ))}
      </div>
    </section>
  );
}
