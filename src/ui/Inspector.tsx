import { useApp } from '../app/store';
import { registry } from '../components/registry';
import { ParamControl } from './ParamField';

export function Inspector() {
  const selectedNodeIds = useApp((s) => s.ui.selectedNodeIds);
  const nodes = useApp((s) => s.design.nodes);
  const layers = useApp((s) => s.design.layers ?? [{ id: 'main', name: 'Main' }]);
  const removeNodes = useApp((s) => s.removeNodes);
  const removeNode = useApp((s) => s.removeNode);
  const moveNodesToLayer = useApp((s) => s.moveNodesToLayer);

  if (selectedNodeIds.length === 0) return null;

  if (selectedNodeIds.length > 1) {
    return (
      <section className="pl-inspector" aria-label="Inspector">
        <div className="pl-inspector__head">
          <span className="pl-inspector__title">{selectedNodeIds.length} components selected</span>
          <select 
            className="pl-param__number" 
            style={{ width: 'auto', flex: 1, minWidth: '100px' }}
            value=""
            onChange={(e) => {
              if (e.target.value) moveNodesToLayer(selectedNodeIds, e.target.value);
            }}
          >
            <option value="" disabled>Move to layer…</option>
            {layers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
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
        <div className="pl-param">
          <span className="pl-param__label">Layer</span>
          <select
            className="pl-param__number"
            style={{ width: 'auto', flex: 1 }}
            value={node.layerId ?? layers[0]?.id ?? 'main'}
            onChange={(e) => moveNodesToLayer([node.id], e.target.value)}
          >
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {spec.params.filter(p => !p.hidden).map((p) => (
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
