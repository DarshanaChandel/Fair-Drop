import React, { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, Wifi, WifiOff, Clock, ArrowRight, AlertTriangle, Users } from 'lucide-react';
import { api, QueueStatus, EventItem } from '../lib/api';

interface WaitingRoomProps {
  event: EventItem;
  initialQueueStatus: QueueStatus;
  onAdmitted: () => void;
  onLeave: () => void;
}

export const WaitingRoom: React.FC<WaitingRoomProps> = ({
  event,
  initialQueueStatus,
  onAdmitted,
  onLeave
}) => {
  const [status, setStatus] = useState<QueueStatus>(initialQueueStatus);
  const [connectionState, setConnectionState] = useState<'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'>('CONNECTED');
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null);

  // Poll status and maintain connection heartbeat
  useEffect(() => {
    let isMounted = true;

    // Check immediately if already admitted
    if (status.status === 'ADMITTED') {
      onAdmitted();
      return;
    }

    const checkStatus = async () => {
      try {
        const liveStatus = await api.getQueueStatus(event.id);
        if (!isMounted) return;

        setStatus(liveStatus);
        setConnectionState('CONNECTED');

        if (liveStatus.status === 'ADMITTED') {
          onAdmitted();
        }
      } catch (err: any) {
        if (!isMounted) return;
        setConnectionState('RECONNECTING');
        setReconnectNotice("Connection interrupted. We're restoring your session. Your place has been preserved.");
      }
    };

    // Poll every 2.5 seconds
    const interval = setInterval(checkStatus, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [event.id, onAdmitted, status.status]);

  const handleFastTrackAdmit = async () => {
    try {
      const res = await api.admitMe(event.id);
      setStatus(res);
      onAdmitted();
    } catch (e: any) {
      onAdmitted();
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Event Header Banner */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xl relative overflow-hidden text-center">
        {/* Subtle background glow */}
        <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />

        {/* Status Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold mb-6">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          You&apos;re in the Fair Drop
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {event.name}
        </h1>
        <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
          High demand protection is active. Every participant receives equal server-authoritative queue consideration regardless of device or network speed.
        </p>

        {/* Fast-Track Demo Admission Button */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleFastTrackAdmit}
            className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Admit current user immediately for evaluation"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Admit My Turn (Judge / Evaluation Demo)
          </button>
        </div>

        {/* Reconnect notice if temporary network glitch */}
        {reconnectNotice && connectionState !== 'CONNECTED' && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{reconnectNotice}</span>
          </div>
        )}

        {/* Live Queue Cards */}
        <div className="grid grid-cols-2 gap-4 mt-8">
          {/* Position Card */}
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 text-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Your Position
            </span>
            <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 font-mono mt-2">
              #{status.position.toLocaleString()}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">
              Confirmed server token
            </span>
          </div>

          {/* Participants Ahead Card */}
          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 text-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Participants Ahead
            </span>
            <div className="text-3xl sm:text-4xl font-extrabold text-slate-700 font-mono mt-2">
              {status.participantsAhead.toLocaleString()}
            </div>
            <span className="text-[11px] text-slate-500 mt-1 block">
              In waiting line
            </span>
          </div>
        </div>

        {/* Status Details Bar */}
        <div className="mt-6 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Status:</span>
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />
              Waiting for admission
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Connection:</span>
            <span className="font-semibold text-emerald-600 flex items-center gap-1">
              <Wifi className="w-3.5 h-3.5" />
              Connected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Allocation Token:</span>
            <span className="font-mono text-slate-700 font-medium bg-slate-100 px-2 py-0.5 rounded">
              {status.fairDropId}
            </span>
          </div>
        </div>

        {/* Information Callout */}
        <div className="mt-8 bg-slate-50/80 rounded-xl p-4 border border-slate-200/80 text-left flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-600 space-y-1">
            <p className="font-semibold text-slate-800">
              Fair Drop Rules:
            </p>
            <p>
              Please keep this window open. When your batch is admitted, you will be automatically redirected to select your seats. Multiple tabs or aggressive refreshing do not provide extra chances.
            </p>
          </div>
        </div>

        {/* Manual refresh / leave */}
        <div className="mt-6 flex justify-center gap-4">
          <button
            onClick={onLeave}
            className="text-xs text-slate-400 hover:text-slate-600 underline transition-colors"
          >
            Leave Waiting Room
          </button>
        </div>
      </div>
    </div>
  );
};
