import { memo, useSyncExternalStore } from 'react';
import {
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { useApp } from '../../app/store';
import { meterService } from '../../audio/meterService';
import { hueFor } from '../constants';

export type SignalEdgeType = Edge<
  { colorIndex: number; kind?: string; sourceNodeId?: string },
  'signal'
>;

function SignalEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<SignalEdgeType>) {
  const traced = useApp((s) => s.ui.trace?.wires.has(id) ?? false);
  const hueIndex = useApp((s) => s.ui.trace?.hueIndex ?? 1);
  const hoverTraceWire = useApp((s) => s.hoverTraceWire);
  const pinTraceWire = useApp((s) => s.pinTraceWire);
  const selectWire = useApp((s) => s.selectWire);
  const removeWire = useApp((s) => s.removeWire);
  const sourceLive = useSyncExternalStore(
    meterService.subscribeActivity,
    () => data?.sourceNodeId ? meterService.isLive(data.sourceNodeId) : false,
    () => false,
  );

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
  });

  const isControl = data?.kind === 'control';
  const isTrigger = data?.kind === 'trigger';
  const hue = isControl ? 'var(--control)' : hueFor(hueIndex);
  const liveHue = isControl ? 'var(--control)' : hueFor(data?.colorIndex ?? hueIndex);
  const glow = traced || sourceLive;

  return (
    <>
      <g className="pl-edge-group">
        {glow && (
          <path
            d={path}
            className={['pl-edge-glow', sourceLive && !traced ? 'is-live-only' : ''].join(' ')}
            style={{ stroke: traced ? hue : liveHue }}
          />
        )}
        <path
          d={path}
          className={[
            'pl-edge',
            traced ? 'is-traced' : '',
            sourceLive ? 'is-live' : '',
            selected ? 'is-selected' : '',
            isControl ? 'is-control' : '',
            isTrigger ? 'is-trigger' : '',
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
      {(selected || traced) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="pl-edge-x nodrag nopan"
            style={{
              position: 'absolute',
              pointerEvents: 'all',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            aria-label="Remove wire"
            title="Remove wire"
            onClick={(e) => {
              e.stopPropagation();
              removeWire(id);
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const SignalEdge = memo(SignalEdgeImpl);
