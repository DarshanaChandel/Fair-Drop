import React, { useState, useEffect } from 'react';
import { X, RefreshCw, ShieldCheck, Lock, Mail, User as UserIcon, AlertCircle, CheckCircle } from 'lucide-react';
import { api, CaptchaData, User, setStoredToken } from '../lib/api';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'signup';
  onClose: () => void;
  onSuccess: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'login',
  onClose,
  onSuccess
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [captchaType, setCaptchaType] = useState<'arithmetic' | 'text'>('arithmetic');
  const [captcha, setCaptcha] = useState<CaptchaData | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (isOpen) {
      loadCaptcha(captchaType);
      setError(null);
      setCaptchaAnswer('');
    }
  }, [isOpen, captchaType]);

  const loadCaptcha = async (type: 'arithmetic' | 'text') => {
    setCaptchaLoading(true);
    setError(null);
    try {
      const data = await api.getCaptcha(type);
      setCaptcha(data);
      setCaptchaAnswer('');
    } catch (err: any) {
      setError(err.message || 'Failed to load CAPTCHA');
    } finally {
      setCaptchaLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        if (!captcha) {
          throw new Error('Please refresh the CAPTCHA');
        }
        const res = await api.login({
          email,
          password,
          captchaId: captcha.challengeId,
          captchaAnswer
        });
        setStoredToken(res.token);
        onSuccess(res.user);
        onClose();
      } else {
        const res = await api.signup({
          name,
          email,
          password,
          captchaId: captcha?.challengeId,
          captchaAnswer
        });
        setStoredToken(res.token);
        onSuccess(res.user);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      // Refresh captcha on failure
      loadCaptcha(captchaType);
    } finally {
      setLoading(false);
    }
  };

  const fillQuickDemo = (role: 'user' | 'admin') => {
    if (role === 'admin') {
      setEmail('admin@fairdrop.io');
      setPassword('Admin@FairDrop2026!');
    } else {
      setEmail('alex@example.com');
      setPassword('User@FairDrop2026!');
    }
    // Attempt to calculate captcha answer if arithmetic
    if (captcha && captcha.type === 'arithmetic') {
      const match = captcha.question.match(/(\d+)\s*([\+\-])\s*(\d+)/);
      if (match) {
        const val = match[2] === '+'
          ? parseInt(match[1]) + parseInt(match[3])
          : parseInt(match[1]) - parseInt(match[3]);
        setCaptchaAnswer(val.toString());
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {mode === 'login' ? 'Sign in to Fair Drop' : 'Create an Account'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'login'
                ? 'Access your tickets and verified waiting room position'
                : 'Join millions of real participants with zero bot priority'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Demo Account Quick Fill Pill Bar */}
        <div className="bg-slate-50 px-6 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-medium">Quick Demo Credentials:</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fillQuickDemo('user')}
              className="px-2.5 py-1 font-semibold rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors shadow-2xs"
            >
              Demo User
            </button>
            <button
              type="button"
              onClick={() => fillQuickDemo('admin')}
              className="px-2.5 py-1 font-semibold rounded bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors shadow-2xs"
            >
              Sentinel Admin
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Alex Mercer"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* Server-Side CAPTCHA Verification */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Human Verification (Server-authoritative)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCaptchaType(captchaType === 'arithmetic' ? 'text' : 'arithmetic')}
                  className="text-[11px] text-slate-500 hover:text-slate-800 underline"
                >
                  Switch to {captchaType === 'arithmetic' ? 'Text' : 'Math'}
                </button>
                <button
                  type="button"
                  onClick={() => loadCaptcha(captchaType)}
                  disabled={captchaLoading}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                  title="Generate new CAPTCHA challenge"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${captchaLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Captcha SVG Preview */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="w-full sm:w-auto shrink-0 bg-slate-100 rounded-lg p-1 border border-slate-200 flex justify-center">
                {captchaLoading ? (
                  <div className="w-[200px] h-[60px] flex items-center justify-center text-xs text-slate-400">
                    Generating...
                  </div>
                ) : captcha?.svgData ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: captcha.svgData }}
                    className="overflow-hidden flex items-center justify-center"
                  />
                ) : null}
              </div>

              <div className="w-full">
                <input
                  type="text"
                  required
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  placeholder={
                    captcha?.type === 'arithmetic'
                      ? 'Answer: e.g. 25'
                      : 'Type the letters above'
                  }
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white uppercase tracking-wider"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Single-use server challenge. Expires in 3 mins.
                </p>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-sm shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : mode === 'login' ? (
              'Sign In'
            ) : (
              'Create Account'
            )}
          </button>

          {/* Toggle Login/Signup */}
          <div className="text-center text-xs text-slate-500 pt-2">
            {mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  className="text-slate-900 font-semibold hover:underline"
                >
                  Create one now
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-slate-900 font-semibold hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
