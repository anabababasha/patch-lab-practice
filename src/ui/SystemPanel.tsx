import { useMemo, useState } from 'react';
import { useApp } from '../app/store';
import { registry } from '../components/registry';
import { validateDesign } from '../graph/validate';
import type { Issue } from '../graph/validate';
import type { ComponentSpec } from '../lib/types';
import { useReactFlow } from '@xyflow/react';

function InfoTab({ spec }: { spec?: ComponentSpec }) {
  if (spec && spec.help) {
    return (
      <div className="pl-system-tab pl-info-tab">
        <div className="pl-info-header">
          <h3>{spec.name}</h3>
          <span className="pl-info-eyebrow">{spec.category}</span>
        </div>
        <p className="pl-info-summary">{spec.help.summary}</p>
        <div className="pl-info-tips">
          <h4>Tips</h4>
          <ul>
            {spec.help.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
        <div className="pl-info-pins">
          <h4>Pins</h4>
          <ul className="pl-pin-legend">
            {spec.pins.map((pin) => (
              <li key={pin.id}>
                <span className={`pl-pin-kind pl-pin-kind--${pin.kind}`} />
                {pin.label} ({pin.kind})
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="pl-system-tab pl-info-tab pl-info-static">
      <h3>PatchLab Guide</h3>
      <p>
        Welcome to PatchLab, a tool for practicing system design. 
      </p>
      <ul>
        <li><strong>Wire:</strong> Drag from an output pin to an input pin. Inputs accept exactly one wire.</li>
        <li><strong>Trace:</strong> Hover or click any pin or wire to trace the signal path.</li>
        <li><strong>Signals:</strong> Solid wires are audio. Dashed wires are control signals.</li>
        <li><strong>Select:</strong> Shift+drag to marquee-select multiple nodes.</li>
      </ul>
    </div>
  );
}

function IssueList({ title, issues }: { title: string; issues: Issue[] }) {
  const selectNode = useApp((s) => s.setSelectedNodes);
  const pinTracePin = useApp((s) => s.pinTracePin);

  if (issues.length === 0) return null;

  return (
    <div className="pl-issue-group">
      <h4>{title} ({issues.length})</h4>
      <ul>
        {issues.map((issue) => (
          <li
            key={issue.id}
            className={`pl-issue pl-issue--${issue.severity}`}
            onClick={() => {
              if (issue.nodeId) selectNode([issue.nodeId]);
              if (issue.pin) pinTracePin(issue.pin);
            }}
          >
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckTab() {
  const design = useApp((s) => s.design);
  const rejections = useApp((s) => s.ui.rejections);
  
  const issues = useMemo(() => validateDesign(design), [design]);
  
  const errors = issues.filter(i => i.severity === 'error');
  const warns = issues.filter(i => i.severity === 'warn');
  const infos = issues.filter(i => i.severity === 'info');

  return (
    <div className="pl-system-tab pl-check-tab">
      {issues.length === 0 && <p className="pl-check-all-good">No issues found.</p>}
      <IssueList title="Errors" issues={errors} />
      <IssueList title="Warnings" issues={warns} />
      <IssueList title="Info" issues={infos} />

      {rejections.length > 0 && (
        <div className="pl-rejections">
          <h4>Recent rejections</h4>
          <ul>
            {rejections.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SystemPanel() {
  const open = useApp((s) => s.ui.panelOpen);
  const setOpen = useApp((s) => s.setPanelOpen);
  const design = useApp((s) => s.design);
  const selectedNodeIds = useApp((s) => s.ui.selectedNodeIds);
  const [tab, setTab] = useState<'info' | 'check'>('info');
  const { fitView } = useReactFlow();

  const handleToggle = (newState: boolean) => {
    setOpen(newState);
    setTimeout(() => fitView({ padding: 0.3, duration: 200 }), 50);
  };

  const issues = useMemo(() => validateDesign(design), [design]);
  const issueCount = issues.length;

  const spec = selectedNodeIds.length === 1 
    ? registry[design.nodes.find(n => n.id === selectedNodeIds[0])?.type ?? '']
    : undefined;

  if (!open) {
    return (
      <div 
        className="pl-system-rail" 
        onClick={() => handleToggle(true)}
        title="Open System Panel"
      >
        <div className="pl-system-rail-label">SYSTEM</div>
        {issueCount > 0 && (
          <div className={`pl-system-rail-badge ${issues.some(i => i.severity === 'error') ? 'is-error' : 'is-warn'}`}>
            {issueCount}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="pl-system-panel">
      <div className="pl-system-header">
        <button className="pl-system-close" onClick={() => handleToggle(false)}>
          &rsaquo;
        </button>
        <div className="pl-segment">
          <button
            className={tab === 'info' ? 'is-on' : ''}
            onClick={() => setTab('info')}
          >
            Info
          </button>
          <button
            className={tab === 'check' ? 'is-on' : ''}
            onClick={() => setTab('check')}
          >
            Check {issueCount > 0 && <span className="pl-badge">{issueCount}</span>}
          </button>
        </div>
      </div>
      <div className="pl-system-content">
        {tab === 'info' ? <InfoTab spec={spec} /> : <CheckTab />}
      </div>
    </section>
  );
}
