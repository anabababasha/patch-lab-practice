import { useState, useRef, useEffect } from 'react';
import { useApp } from '../app/store';

function LayerPill({ 
  id, 
  name, 
  count, 
  isActive, 
  onSelect, 
  onDelete,
  onRename
}: { 
  id: string; 
  name: string; 
  count: number; 
  isActive: boolean; 
  onSelect: () => void; 
  onDelete?: () => void;
  onRename?: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (editing && onRename) {
    return (
      <div className="pl-layer-pill is-editing">
        <input 
          ref={inputRef}
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              onRename(editName);
              setEditing(false);
            } else if (e.key === 'Escape') {
              setEditName(name);
              setEditing(false);
            }
          }}
          onBlur={() => {
            onRename(editName);
            setEditing(false);
          }}
          style={{ width: `${Math.max(40, editName.length * 8)}px` }}
        />
      </div>
    );
  }

  return (
    <div 
      className={`pl-layer-pill ${isActive ? 'is-active' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => { if (onRename) setEditing(true); }}
    >
      <span className="pl-layer-pill__name">{name}</span>
      <span className="pl-layer-pill__count">{count}</span>
      {!isActive && onDelete && (
        <button 
          className="pl-layer-pill__del"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Delete layer"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function LayerBar() {
  const layers = useApp(s => s.design.layers ?? [{ id: 'main', name: 'Main' }]);
  const nodes = useApp(s => s.design.nodes);
  const activeLayerId = useApp(s => s.ui.activeLayerId);
  const addLayer = useApp(s => s.addLayer);
  const setActiveLayer = useApp(s => s.setActiveLayer);
  const renameLayer = useApp(s => s.renameLayer);
  const deleteLayer = useApp(s => s.deleteLayer);

  const firstLayerId = layers[0].id;

  const getCount = (id: string) => 
    nodes.filter(n => (n.layerId ?? firstLayerId) === id).length;

  return (
    <div className="pl-layer-bar">
      <div 
        className={`pl-layer-pill ${activeLayerId === 'all' ? 'is-active' : ''}`}
        onClick={() => setActiveLayer('all')}
      >
        <span className="pl-layer-pill__name">All</span>
        <span className="pl-layer-pill__count">{nodes.length}</span>
      </div>
      
      <div className="pl-layer-bar__div" />

      {layers.map(l => (
        <LayerPill
          key={l.id}
          id={l.id}
          name={l.name}
          count={getCount(l.id)}
          isActive={activeLayerId === l.id}
          onSelect={() => setActiveLayer(l.id)}
          onDelete={() => deleteLayer(l.id)}
          onRename={(newName) => renameLayer(l.id, newName)}
        />
      ))}
      
      <button 
        className="pl-layer-pill pl-layer-add"
        onClick={addLayer}
        title="Add layer"
      >
        +
      </button>
    </div>
  );
}
