import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './ui/TopBar';
import { Palette } from './ui/Palette';
import { FlowCanvas } from './ui/FlowCanvas';
import { Inspector } from './ui/Inspector';
import { LayerBar } from './ui/LayerBar';
import { Toast } from './ui/Toast';
import { SystemPanel } from './ui/SystemPanel';
import { ErrorBoundary } from './ui/ErrorBoundary';

export default function App() {
  return (
    <div className="pl-app">
      <TopBar />
      <ErrorBoundary>
        <ReactFlowProvider>
          <div className="pl-main">
            <Palette />
            <div className="pl-canvas-wrap">
              <LayerBar />
              <FlowCanvas />
              <Inspector />
            </div>
            <SystemPanel />
          </div>
        </ReactFlowProvider>
      </ErrorBoundary>
      <Toast />
    </div>
  );
}
