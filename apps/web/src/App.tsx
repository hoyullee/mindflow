import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './features/auth/Login';
import { HomePlaceholder } from './features/home/HomePlaceholder';

// M3: Login.dc.html ported to React. Home.dc.html / the mindmap editor
// follow in later milestones — `/home` is a placeholder until then.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<HomePlaceholder />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
