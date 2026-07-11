import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './ui/TopBar';
import { Palette } from './ui/Palette';
import { FlowCanvas } from './ui/FlowCanvas';
import { Inspector } from './ui/Inspector';
import { LayerBar } from './ui/LayerBar';
import { Toast } from './ui/Toast';
import { SystemPanel } from './ui/SystemPanel';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { PerformView } from './ui/PerformView';
import { useApp } from './app/store';

export default function App() {
  const performOpen = useApp((s) => s.ui.performOpen);
  return (
    <div className="pl-app">
      <TopBar />
      <ErrorBoundary>
        <ReactFlowProvider>
          <>
            <div className="pl-main">
              <Palette />
              <div className="pl-canvas-wrap">
                <LayerBar />
                <FlowCanvas />
                <Inspector />
              </div>
              <SystemPanel />
            </div>
            {performOpen && <PerformView />}
          </>
        </ReactFlowProvider>
      </ErrorBoundary>
      <Toast />
    </div>
  );
}
