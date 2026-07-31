import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof Error && 'status' in error && error.status === 401) return false;
        return failureCount < 2;
      },
    },
  },
});

const canonicalCrmOrigin = 'https://crm.skarion.com';
const legacyPagesHost =
  window.location.hostname === 'skarion-crm-cv9.pages.dev' ||
  window.location.hostname.endsWith('.skarion-crm-cv9.pages.dev') ||
  window.location.hostname === 'skarion-crm.pages.dev' ||
  window.location.hostname.endsWith('.skarion-crm.pages.dev');

if (import.meta.env.PROD && legacyPagesHost) {
  const canonicalUrl = new URL(canonicalCrmOrigin);
  canonicalUrl.pathname = window.location.pathname;
  canonicalUrl.search = window.location.search;
  canonicalUrl.hash = window.location.hash;
  window.location.replace(canonicalUrl.toString());
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
}
