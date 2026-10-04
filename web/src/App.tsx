import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';

import { api, Me } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TenantPage from './pages/TenantPage';

// Sessão do dono: sem ela, só a tela de entrar
export default function App() {
  // undefined: conferindo a sessão
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const load = useCallback(() => {
    api<Me>('/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (me === undefined) return null;
  if (!me) return <Login onLogged={load} />;

  return (
    <>
      <div className="topbar">
        <Link to="/" className="brand">
          <span className="mark">✂</span>
          Pontual <small>· Painel</small>
        </Link>
        <span className="spacer" />
        <span className="muted" style={{ display: 'inline' }}>
          {me.email}
        </span>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => api('/logout', { method: 'POST' }).then(() => setMe(null))}
        >
          Sair
        </button>
      </div>

      <Routes>
        <Route path="/" element={<Dashboard me={me} />} />
        <Route path="/negocios/:id" element={<TenantPage />} />
        <Route path="/barbearias/:id" element={<TenantPage />} />
        <Route path="*" element={<Dashboard me={me} />} />
      </Routes>
    </>
  );
}
