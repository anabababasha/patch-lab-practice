import React from 'react';

export interface MiniFlowProps {
  flows: Array<{
    title: string;
    chain: Array<{
      label: string;
      kind?: 'audio' | 'control' | 'trigger';
    }>;
  }>;
}

export function MiniFlow({ flows }: MiniFlowProps) {
  return (
    <div className="pl-miniflow-container">
      {flows.map((flow, i) => (
        <div key={i} className="pl-miniflow-item">
          <h5 className="pl-miniflow-title">{flow.title}</h5>
          <div className="pl-miniflow-chain">
            {flow.chain.map((link, j) => {
              const isLast = j === flow.chain.length - 1;
              return (
                <React.Fragment key={j}>
                  <div className="pl-miniflow-node">{link.label}</div>
                  {!isLast && (
                    <div className="pl-miniflow-edge">
                      <svg width="24" height="2" viewBox="0 0 24 2" xmlns="http://www.w3.org/2000/svg">
                        <line 
                          x1="0" y1="1" x2="24" y2="1" 
                          stroke="var(--wire-idle)" 
                          strokeWidth="2"
                          strokeDasharray={
                            flow.chain[j + 1].kind === 'control' ? '5 4' :
                            flow.chain[j + 1].kind === 'trigger' ? '2 3' : 'none'
                          }
                        />
                      </svg>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
