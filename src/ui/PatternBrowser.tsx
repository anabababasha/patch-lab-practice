import { useState } from 'react';
import { useApp } from '../app/store';
import { patterns, traditionLabels, Tradition, RhythmPattern } from '../patterns';

export function PatternPreview({ pattern }: { pattern: RhythmPattern }) {
  const steps = pattern.steps;
  const numRows = Math.max(1, pattern.rows.length);
  // Row 1 gets warmer tint
  const getStyle = (r: number, active: boolean) => {
    if (!active) return { background: 'var(--surface)' };
    if (r === 0) return { background: 'color-mix(in srgb, var(--signal-2) 55%, var(--text-secondary))' };
    return { background: 'var(--text-secondary)' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
      {Array.from({ length: numRows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: '1px' }}>
          {Array.from({ length: steps }).map((_, c) => {
            const active = pattern.rows[r]?.[c] === 1;
            return (
              <div 
                key={c}
                style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '1px',
                  ...getStyle(r, active)
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function PatternBrowser() {
  const selectedNodeIds = useApp((s) => s.ui.selectedNodeIds);
  const design = useApp((s) => s.design);
  const setParamsBulk = useApp((s) => s.setParamsBulk);
  const showToast = useApp((s) => s.showToast);
  
  const seqId = selectedNodeIds.length === 1 && design.nodes.find(n => n.id === selectedNodeIds[0])?.type === 'step_seq' 
    ? selectedNodeIds[0] 
    : null;

  const handleLoad = (pat: RhythmPattern) => {
    if (!seqId) return;
    const p: Record<string, number> = {};
    for (let r = 1; r <= 4; r++) {
      for (let c = 1; c <= 16; c++) {
        p[`s${r}_${c}`] = 0;
      }
    }
    p.steps = pat.steps;
    p.rate = pat.rate;
    for (let r = 0; r < pat.rows.length; r++) {
      for (let c = 0; c < pat.rows[r].length; c++) {
        p[`s${r + 1}_${c + 1}`] = pat.rows[r][c];
      }
    }
    setParamsBulk(seqId, p, { pattern: pat.id });
    showToast(`${pat.name} loaded`);
  };

  const [openSection, setOpenSection] = useState<Tradition>('iqaat');

  return (
    <div className="pl-system-tab pl-patterns-tab">
      {!seqId && (
        <div style={{ marginBottom: '16px', padding: '8px', background: 'var(--surface)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
          Select a Step Sequencer to load patterns.
        </div>
      )}

      {(Object.keys(traditionLabels) as Tradition[]).map(trad => {
        const groupPatterns = patterns.filter(p => p.tradition === trad);
        if (groupPatterns.length === 0) return null;
        
        const isOpen = openSection === trad;
        return (
          <div key={trad} style={{ marginBottom: '8px' }}>
            <button
              className="pl-mini-btn"
              style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', padding: '6px 8px' }}
              onClick={() => setOpenSection(isOpen ? '' as any : trad)}
            >
              <span>{traditionLabels[trad]} <span style={{ color: 'var(--text-disabled)' }}>({groupPatterns.length})</span></span>
              <span>{isOpen ? '▼' : '▶'}</span>
            </button>
            
            {isOpen && (
              <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
                {groupPatterns.map(pat => (
                  <div key={pat.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                    {/* Line 1: Header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', minWidth: 0 }}>
                      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
                          {pat.name}
                          {pat.status === 'verified' && (
                            <span 
                              title="Verified against a cited source" 
                              style={{ color: 'color-mix(in srgb, var(--signal-1) 70%, transparent)', marginLeft: '4px' }}
                            >
                              ✓
                            </span>
                          )}
                        </span>
                        {pat.status === 'draft' && (
                          <span 
                            title="Awaiting curator verification — pattern may be refined"
                            style={{ 
                              flex: 'none',
                              fontSize: '9px', textTransform: 'uppercase', 
                              color: 'var(--text-disabled)', border: '1px solid var(--border)', 
                              borderRadius: '999px', padding: '0 4px', lineHeight: '14px' 
                            }}
                          >
                            draft
                          </span>
                        )}
                        <span style={{ flex: 'none', fontSize: '10px', padding: '0 4px', border: '1px solid var(--border)', borderRadius: '999px', fontFamily: 'var(--font-data)' }}>
                          {pat.meter}
                        </span>
                      </div>
                      <button 
                        className="pl-mini-btn" 
                        disabled={!seqId}
                        style={{ flex: 'none', ...(!seqId ? { color: 'var(--text-disabled)' } : {}) }}
                        onClick={() => handleLoad(pat)}
                      >
                        Load
                      </button>
                    </div>
                    {/* Line 2: Preview */}
                    <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
                      <PatternPreview pattern={pat} />
                    </div>
                    {/* Line 3: Note */}
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic', minWidth: 0, whiteSpace: 'normal', wordWrap: 'break-word' }}>
                      {pat.note}
                    </div>
                    {/* Line 4: Source */}
                    {pat.source && (
                      <div style={{ fontSize: '10px', color: 'var(--text-disabled)', minWidth: 0 }}>
                        Source: {pat.source}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
