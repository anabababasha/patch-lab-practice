import { useReactFlow } from '@xyflow/react';
import { useApp } from '../app/store';
import { paletteOrder, registry } from '../components/registry';
import { NODE_WIDTH } from './constants';

export const DND_MIME = 'application/x-patchlab-component';

export function Palette() {
  const addNode = useApp((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();

  const addAtCenter = (type: string) => {
    const wrap = document.querySelector('.pl-canvas-wrap');
    const rect = wrap?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const p = screenToFlowPosition({ x: cx, y: cy });
    // slight scatter so repeated clicks don't stack perfectly
    const jitter = () => (Math.random() - 0.5) * 40;
    addNode(type, p.x - NODE_WIDTH / 2 + jitter(), p.y + jitter());
  };

  return (
    <aside className="pl-palette" aria-label="Component palette">
      {paletteOrder.map((group) => (
        <div className="pl-palette__group" key={group.category}>
          <div className="pl-palette__eyebrow">{group.label}</div>
          {group.types.map((type) => {
            const spec = registry[type];
            return (
              <button
                key={type}
                className="pl-palette__item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, type);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => addAtCenter(type)}
                title={`Add ${spec.name}`}
              >
                <span className={`pl-dot cat-${spec.category}`} />
                {spec.name}
              </button>
            );
          })}
        </div>
      ))}
      <div className="pl-palette__hint">Click or drag onto the canvas</div>
    </aside>
  );
}
