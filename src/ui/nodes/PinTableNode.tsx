import { memo, useCallback, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useApp } from '../../app/store';
import { registry } from '../../components/registry';
import { pinKey } from '../../lib/types';
import { meterService } from '../../audio/meterService';
import { HEADER_H, ROW_H, hueFor } from '../constants';

export type PinTableNodeType = Node<{ pl: true }, 'pinTable'>;

function PinTableNodeImpl({ id, selected }: NodeProps<PinTableNodeType>) {
  const node = useApp((s) => s.design.nodes.find((n) => n.id === id));
  const trace = useApp((s) => s.ui.trace);
  const hoverTracePin = useApp((s) => s.hoverTracePin);
  const pinTracePin = useApp((s) => s.pinTracePin);

  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => meterService.attachCanvas(id, el),
    [id],
  );

  if (!node) return null;
  const spec = registry[node.type];
  if (!spec) return null;

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
        const idx = isIn
          ? inPins.indexOf(pin) + 1
          : outPins.indexOf(pin) + 1;
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
              useApp.getState().selectNode(id);
            }}
          >
            <span className="pl-pinrow__index">{idx}</span>
            <span className="pl-pinrow__label">{pin.label}</span>
            <Handle
              id={pin.id}
              type={isIn ? 'target' : 'source'}
              position={isIn ? Position.Left : Position.Right}
              className={['pl-handle', traced ? 'is-traced' : ''].join(' ')}
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
    </div>
  );
}

export const PinTableNode = memo(PinTableNodeImpl);
