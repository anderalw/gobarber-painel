import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import './styles.css';

// Página de divulgação: no domínio principal o servidor marca o HTML com
// data-mode="site"; em desenvolvimento, pelo endereço /divulgacao
const Site = lazy(() => import('./site/Site'));
const isSite =
  document.documentElement.dataset.mode === 'site' ||
  window.location.pathname.startsWith('/divulgacao');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isSite ? (
      <Suspense fallback={null}>
        <Site />
      </Suspense>
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </React.StrictMode>,
);
