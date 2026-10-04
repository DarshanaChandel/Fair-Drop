import React from 'react';
import { X, Printer, Calendar, MapPin, Ticket, ShieldCheck } from 'lucide-react';
import { Booking } from '../lib/api';

interface DigitalTicketModalProps {
  booking: Booking | null;
  onClose: () => void;
}

export const DigitalTicketModal: React.FC<DigitalTicketModalProps> = ({ booking, onClose }) => {
  if (!booking) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden relative">
        {/* Header Action Bar */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider">Fair Drop Pass</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition-colors text-xs flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Ticket Body */}
        <div className="p-6">
          <div className="border-b border-slate-100 pb-4">
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 uppercase tracking-wider">
              Guaranteed Entry
            </span>
            <h2 className="text-xl font-extrabold text-slate-900 mt-2">
              {booking.event_name || 'Event Ticket'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              Ref: {booking.booking_ref}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 py-4 border-b border-slate-100 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Date &amp; Time</span>
              <span className="font-semibold text-slate-800 mt-0.5 block">
                {booking.event_date || 'Upcoming'}
              </span>
              <span className="text-slate-500 text-[11px] block">{booking.event_time}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Pass Tier</span>
              <span className="font-semibold text-slate-800 mt-0.5 block">
                {booking.ticket_name || 'Standard Pass'}
              </span>
              <span className="text-slate-500 text-[11px] block">{booking.quantity} Attendee(s)</span>
            </div>
            <div className="col-span-2">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Venue Location</span>
              <span className="font-semibold text-slate-800 mt-0.5 block">
                {booking.event_venue}, {booking.event_city}
              </span>
            </div>
          </div>

          {/* Seat Numbers if available */}
          {booking.seats && booking.seats.length > 0 && (
            <div className="py-3 border-b border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Assigned Seat(s):</span>
              <div className="flex gap-1.5">
                {booking.seats.map((s, idx) => (
                  <span key={idx} className="font-mono bg-slate-100 font-bold px-2 py-0.5 rounded text-slate-800 border border-slate-200">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* QR Code and Barcode */}
          <div className="mt-4 pt-4 flex flex-col items-center">
            {/* SVG QR Code */}
            <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs">
              <svg width="110" height="110" viewBox="0 0 110 110" fill="none">
                <rect width="110" height="110" fill="white"/>
                <rect x="10" y="10" width="28" height="28" fill="#0f172a" rx="3"/>
                <rect x="15" y="15" width="18" height="18" fill="white" rx="1"/>
                <rect x="19" y="19" width="10" height="10" fill="#0f172a"/>

                <rect x="72" y="10" width="28" height="28" fill="#0f172a" rx="3"/>
                <rect x="77" y="15" width="18" height="18" fill="white" rx="1"/>
                <rect x="81" y="19" width="10" height="10" fill="#0f172a"/>

                <rect x="10" y="72" width="28" height="28" fill="#0f172a" rx="3"/>
                <rect x="15" y="77" width="18" height="18" fill="white" rx="1"/>
                <rect x="19" y="81" width="10" height="10" fill="#0f172a"/>

                <rect x="45" y="14" width="8" height="8" fill="#0f172a"/>
                <rect x="58" y="24" width="8" height="8" fill="#0f172a"/>
                <rect x="46" y="44" width="18" height="8" fill="#0f172a"/>
                <rect x="72" y="46" width="14" height="14" fill="#0f172a"/>
                <rect x="46" y="72" width="12" height="18" fill="#0f172a"/>
                <rect x="68" y="80" width="18" height="8" fill="#0f172a"/>
              </svg>
            </div>

            {/* Visual Barcode */}
            <div className="w-full flex justify-center gap-0.5 mt-4 h-9 px-4">
              {[3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 4, 1, 2, 3, 1, 4, 2, 1, 3, 2, 4, 1, 2].map((w, i) => (
                <div key={i} className="bg-slate-900 h-full" style={{ width: `${w * 2}px` }} />
              ))}
            </div>
            <span className="font-mono text-[9px] text-slate-400 mt-1">
              AUTHENTICATED VIA FAIR DROP SENTINEL
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
