import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { initNativeShell } from './platform/nativeShell';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// M7: no-op on the web (isNativePlatform() is false outside the Capacitor
// shell) — sets StatusBar color/style + Keyboard resize mode when running as
// the wrapped native app. Fire-and-forget; never blocks first paint.
void initNativeShell();
