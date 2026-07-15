import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './features/auth/Login';
import { Home } from './features/home/Home';
import { EditorPlaceholder } from './features/editor/EditorPlaceholder';

// M3: Login.dc.html and Home.dc.html ported to React. MindFlow.dc.html (the
// mindmap editor) follows in a later milestone — `/editor` is a placeholder
// until then.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<Home />} />
        <Route path="/editor" element={<EditorPlaceholder />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
