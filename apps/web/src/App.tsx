import { CORE_VERSION } from '@mindflow/mindmap-core';

// M0 scaffold: proves the web app builds and consumes mindmap-core.
// The real editor (ported from MindFlow.dc.html) arrives in M3.
export function App() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontFamily: 'system-ui, sans-serif',
        background: '#fbf6f2',
        color: '#33281f',
      }}
    >
      <h1 style={{ margin: 0 }}>MindFlow</h1>
      <p style={{ color: '#9c8b7e', margin: 0 }}>
        web scaffold · mindmap-core v{CORE_VERSION}
      </p>
    </main>
  );
}
