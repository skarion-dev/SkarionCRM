import { Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login.js';
import { ForgotPassword } from './pages/ForgotPassword.js';
import { ResetPassword } from './pages/ResetPassword.js';
import { AcceptInvite } from './pages/AcceptInvite.js';

// No /register route - invite-only, per spec. The Worker also 404s it
// server-side; this is just so the client router doesn't render anything
// for it either.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
