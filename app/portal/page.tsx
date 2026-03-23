'use client';

import { useState } from 'react';
import { Loader2, Mail, Lock, KeyRound } from 'lucide-react';

export default function PortalLoginPage() {
  const [step, setStep] = useState<'credentials' | 'verify'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionToken, setSessionToken] = useState('');

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      if (data.skipVerify) {
        // 2FA disabled — go directly to dashboard
        window.location.href = `/portal/dashboard?token=${data.token}`;
        return;
      }
      setSessionToken(data.sessionToken);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
    setLoading(false);
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portal/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, code: verifyCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      // Redirect to dashboard
      window.location.href = `/portal/dashboard?token=${data.token}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-slate-900">Client Audit Portal</h1>
          <p className="text-sm text-slate-500 mt-1">
            Securely access and respond to audit evidence requests.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {step === 'credentials' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <Mail className="h-3.5 w-3.5 inline mr-1" />Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="your@email.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <Lock className="h-3.5 w-3.5 inline mr-1" />Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            <button
              onClick={handleLogin}
              disabled={loading || !email || !password}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'Sign In'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <KeyRound className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <p className="text-sm text-blue-800">
                A 6-digit verification code has been sent to <strong>{email}</strong>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Verification Code</label>
              <input
                type="text"
                value={verifyCode}
                onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && verifyCode.length === 6 && handleVerify()}
                className="w-full px-3 py-2 text-center text-2xl tracking-[0.5em] font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="000000"
                maxLength={6}
              />
            </div>
            <button
              onClick={handleVerify}
              disabled={loading || verifyCode.length !== 6}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'Verify'}
            </button>
            <button
              onClick={() => { setStep('credentials'); setError(''); }}
              className="w-full text-xs text-slate-500 hover:text-slate-700"
            >
              Back to login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
