import { memo } from 'react';
import { getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { useApp } from '../../app/store';
import { hueFor } from '../constants';

export type SignalEdgeType = Edge<{ colorIndex: number }, 'signal'>;

function SignalEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps<SignalEdgeType>) {
  const traced = useApp((s) => s.ui.trace?.wires.has(id) ?? false);
  const hueIndex = useApp((s) => s.ui.trace?.hueIndex ?? 1);
  const hoverTraceWire = useApp((s) => s.hoverTraceWire);
  const pinTraceWire = useApp((s) => s.pinTraceWire);
  const selectWire = useApp((s) => s.selectWire);

  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
  });

  const hue = hueFor(hueIndex);

  return (
    <g className="pl-edge-group">
      {traced && (
        <path d={path} className="pl-edge-glow" style={{ stroke: hue }} />
      )}
      <path
        d={path}
        className={[
          'pl-edge',
          traced ? 'is-traced' : '',
          selected ? 'is-selected' : '',
        ].join(' ')}
        style={traced ? { stroke: hue } : undefined}
      />
      <path
        d={path}
        className="pl-edge-hit"
        onMouseEnter={() => hoverTraceWire(id)}
        onMouseLeave={() => hoverTraceWire(null)}
        onClick={(e) => {
          e.stopPropagation();
          selectWire(id);
          pinTraceWire(id);
        }}
      />
    </g>
  );
}

export const SignalEdge = memo(SignalEdgeImpl);
