import React from 'react';
import { X, ShieldCheck, ZapOff, Users, CheckCircle, Clock } from 'lucide-react';

interface HowItWorksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HowItWorksModal: React.FC<HowItWorksModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                The Fair Drop Standard
              </h2>
              <p className="text-xs text-slate-500">
                Why high-demand tickets shouldn&apos;t be a race against bots
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs text-slate-600">
          <div className="flex items-start gap-3.5">
            <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-800 font-bold flex items-center justify-center shrink-0">
              1
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-0.5">
                No Millisecond Races
              </h3>
              <p>
                In ordinary ticketing systems, whoever has the closest data center or a bot script buying in 12ms wins. Fair Drop gathers participants into a fair arrival window with verified human identities.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-800 font-bold flex items-center justify-center shrink-0">
              2
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-0.5">
                Spam Yields Zero Advantage
              </h3>
              <p>
                Sending 10,000 automated requests or opening 50 tabs produces the exact same single allocation token as a real person clicking once. Automation volume cannot multiply chances.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-800 font-bold flex items-center justify-center shrink-0">
              3
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-0.5">
                Resilient Server Sessions
              </h3>
              <p>
                If your Wi-Fi flickers or you refresh, you do not lose your spot. Server-authoritative queues preserve your position seamlessly.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-800 font-bold flex items-center justify-center shrink-0">
              4
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-0.5">
                Zero Overselling Guarantee
              </h3>
              <p>
                Strict transactional locks ensure that no ticket can ever be sold twice, and holds automatically expire back to the community if not completed within 5 minutes.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center">
            <span className="font-bold text-slate-800 text-xs block">
              100% Transparent Event Access
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5 block">
              Proudly protecting genuine fans and participants across all major drops.
            </span>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-900 text-white font-semibold text-xs rounded-xl shadow-xs hover:bg-slate-800 transition-colors"
          >
            Got it, thanks
          </button>
        </div>
      </div>
    </div>
  );
};
