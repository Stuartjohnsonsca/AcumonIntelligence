'use client';

import { useState } from 'react';
import { Loader2, Mail, Lock, KeyRound, ArrowLeft, CheckCircle } from 'lucide-react';

export default function PortalLoginPage() {
  const [step, setStep] = useState<'credentials' | 'verify' | 'forgot' | 'reset_code' | 'new_password' | 'reset_done'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [message, setMessage] = useState('');

  // Password reset state
  const [resetCode, setResetCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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
      window.location.href = `/portal/dashboard?token=${data.token}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
    setLoading(false);
  };

  // Step 1: Request password reset — sends a code to email
  const handleForgotPassword = async () => {
    if (!email) { setError('Please enter your email address'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portal/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reset code');
      setMessage(data.message || 'Reset code sent to your email');
      setStep('reset_code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset code');
    }
    setLoading(false);
  };

  // Step 2: Verify the code
  const handleVerifyResetCode = async () => {
    if (resetCode.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portal/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', email, code: resetCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code');
      setResetToken(data.resetToken);
      setStep('new_password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    }
    setLoading(false);
  };

  // Step 3: Set new password
  const handleSetNewPassword = async () => {
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portal/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', email, resetToken, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      // The email-based reset code has already proven possession of
      // the account's inbox — that's the same signal the login 2FA
      // code would re-establish. So if the server returned a session
      // token, sign the user straight in rather than sending them
      // back to re-type the password + wait for another email code.
      if (data.token) {
        window.location.href = `/portal/dashboard?token=${data.token}`;
        return;
      }
      setStep('reset_done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    }
    setLoading(false);
  };

  function goBackToLogin() {
    setStep('credentials');
    setError('');
    setMessage('');
    setResetCode('');
    setResetToken('');
    setNewPassword('');
    setConfirmPassword('');
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-slate-900">Client Audit Portal</h1>
          <p className="text-sm text-slate-500 mt-1">
            {step === 'forgot' || step === 'reset_code' || step === 'new_password'
              ? 'Reset your password'
              : 'Securely access and respond to audit evidence requests.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {message && !error && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            {message}
          </div>
        )}

        {/* Login */}
        {step === 'credentials' && (
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
            <button
              onClick={() => { setStep('forgot'); setError(''); setMessage(''); }}
              className="w-full text-xs text-blue-600 hover:text-blue-800"
            >
              Forgot your password?
            </button>
          </div>
        )}

        {/* 2FA Verify */}
        {step === 'verify' && (
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

        {/* Forgot Password — enter email */}
        {step === 'forgot' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Enter the email address associated with your portal account and we will send you a reset code.
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <Mail className="h-3.5 w-3.5 inline mr-1" />Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleForgotPassword()}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="your@email.com"
              />
            </div>
            <button
              onClick={handleForgotPassword}
              disabled={loading || !email}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'Send Reset Code'}
            </button>
            <button onClick={goBackToLogin} className="w-full text-xs text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Back to login
            </button>
          </div>
        )}

        {/* Reset code entry */}
        {step === 'reset_code' && (
          <div className="space-y-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <KeyRound className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <p className="text-sm text-blue-800">
                A 6-digit reset code has been sent to <strong>{email}</strong>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reset Code</label>
              <input
                type="text"
                value={resetCode}
                onChange={e => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && resetCode.length === 6 && handleVerifyResetCode()}
                className="w-full px-3 py-2 text-center text-2xl tracking-[0.5em] font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="000000"
                maxLength={6}
              />
            </div>
            <button
              onClick={handleVerifyResetCode}
              disabled={loading || resetCode.length !== 6}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'Verify Code'}
            </button>
            <button onClick={goBackToLogin} className="w-full text-xs text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Back to login
            </button>
          </div>
        )}

        {/* Set new password */}
        {step === 'new_password' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Enter your new password (minimum 8 characters).</p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <Lock className="h-3.5 w-3.5 inline mr-1" />New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <Lock className="h-3.5 w-3.5 inline mr-1" />Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSetNewPassword()}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            <button
              onClick={handleSetNewPassword}
              disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin inline" /> : 'Reset Password'}
            </button>
          </div>
        )}

        {/* Reset complete */}
        {step === 'reset_done' && (
          <div className="space-y-4 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            <p className="text-sm text-green-700 font-medium">
              Your password has been reset successfully.
            </p>
            <button
              onClick={goBackToLogin}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
