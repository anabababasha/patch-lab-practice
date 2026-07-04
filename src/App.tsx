import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './ui/TopBar';
import { Palette } from './ui/Palette';
import { FlowCanvas } from './ui/FlowCanvas';
import { Inspector } from './ui/Inspector';
import { Toast } from './ui/Toast';
import { SystemPanel } from './ui/SystemPanel';

export default function App() {
  return (
    <div className="pl-app">
      <TopBar />
      <ReactFlowProvider>
        <div className="pl-main">
          <Palette />
          <div className="pl-canvas-wrap">
            <FlowCanvas />
            <Inspector />
          </div>
          <SystemPanel />
        </div>
      </ReactFlowProvider>
      <Toast />
    </div>
  );
}
