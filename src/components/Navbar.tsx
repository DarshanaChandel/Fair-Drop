import React from 'react';
import { Ticket, Shield, User as UserIcon, LogOut, Sparkles, AlertCircle, Compass, CalendarCheck } from 'lucide-react';
import { User } from '../lib/api';

interface NavbarProps {
  user: User | null;
  currentView: string;
  onNavigate: (view: string, data?: any) => void;
  onOpenAuth: (mode?: 'login' | 'signup') => void;
  onOpenHowItWorks: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  currentView,
  onNavigate,
  onOpenAuth,
  onOpenHowItWorks,
  onLogout,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2.5 group text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-105">
              <Ticket className="w-5 h-5 text-emerald-400 -rotate-12" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight text-slate-900 block leading-tight">
                FAIR<span className="text-emerald-600">DROP</span>
              </span>
              <span className="text-[10px] tracking-wider uppercase font-semibold text-slate-500 block">
                Verified Ticket Engine
              </span>
            </div>
          </button>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            <button
              onClick={() => onNavigate('events')}
              className={`px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
                currentView === 'events'
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Compass className="w-4 h-4" />
              Browse Events
            </button>
            <button
              onClick={onOpenHowItWorks}
              className="px-3.5 py-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-4 h-4 text-emerald-600" />
              Fair Drop Standard
            </button>
            {user && (
              <button
                onClick={() => onNavigate('my-bookings')}
                className={`px-3.5 py-2 rounded-lg transition-colors flex items-center gap-1.5 ${
                  currentView === 'my-bookings'
                    ? 'bg-slate-100 text-slate-900 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <CalendarCheck className="w-4 h-4" />
                My Bookings
              </button>
            )}
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Admin Switcher */}
          {user?.role === 'ADMIN' ? (
            <button
              onClick={() => onNavigate(currentView.startsWith('admin') ? 'home' : 'admin')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 ${
                currentView.startsWith('admin')
                  ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              {currentView.startsWith('admin') ? 'Exit Sentinel' : 'Sentinel Console'}
            </button>
          ) : (
            <button
              onClick={() => onNavigate('admin')}
              className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition-colors border border-transparent hover:border-slate-200"
              title="Admin Portal for event operators"
            >
              <Shield className="w-3 h-3" />
              Admin Portal
            </button>
          )}

          {/* User Auth Info */}
          {user ? (
            <div className="flex items-center gap-2">
              <div
                onClick={() => onNavigate('profile')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="text-left hidden sm:block">
                  <span className="text-xs font-semibold text-slate-800 block leading-tight">
                    {user.name}
                  </span>
                  <span className="text-[10px] text-slate-500 block leading-none font-medium">
                    {user.role === 'ADMIN' ? 'Administrator' : 'Verified Member'}
                  </span>
                </div>
              </div>
              <button
                onClick={onLogout}
                title="Log out"
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenAuth('login')}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
              >
                Log In
              </button>
              <button
                onClick={() => onOpenAuth('signup')}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-all"
              >
                Create Account
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
