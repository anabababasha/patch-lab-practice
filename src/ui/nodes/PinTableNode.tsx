import React, { memo, useCallback, useRef, type CSSProperties } from 'react';
import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react';
import { useApp } from '../../app/store';
import { registry } from '../../components/registry';
import { pinKey } from '../../lib/types';
import { meterService } from '../../audio/meterService';
import { scopeService, type ScopeMode } from '../../audio/scopeService';
import { HEADER_H, ROW_H, hueFor } from '../constants';

export type PinTableNodeType = Node<{ pl: true }, 'pinTable'>;

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

  const conn = useConnection();
  const wires = useApp((s) => s.design.wires);
  const designNodes = useApp((s) => s.design.nodes);
  
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

  if (!node) return null;
  const spec = registry[node.type];
  if (!spec) return null;

  if (spec.display === 'scope') {
    scopeService.setMode(id, (Math.round(node.params.mode ?? 0) as ScopeMode) || 0);
  }

  const onPath = trace?.nodes.has(id) ?? false;
  const hue = trace ? hueFor(trace.hueIndex) : undefined;

  const inPins = spec.pins.filter((p) => p.direction === 'in');
  const outPins = spec.pins.filter((p) => p.direction === 'out');

  return (
    <div
      className={[
        'pl-node',
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
                hintClass,
              ].join(' ')}
              style={
                { '--pl-pin-hue': traced ? hue : undefined } as CSSProperties
              }
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
    </div>
  );
}

export const PinTableNode = memo(PinTableNodeImpl);
