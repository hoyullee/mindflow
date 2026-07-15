import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './features/auth/Login';
import { Home } from './features/home/Home';
import { Editor } from './features/editor/Editor';

// M3: Login.dc.html, Home.dc.html, and (as of Editor-a) MindFlow.dc.html's
// rendering/pan-zoom/view-layout-theme slice are ported to React. Selection,
// editing, and persistence land on `/editor` in Editor-b.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<Home />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
