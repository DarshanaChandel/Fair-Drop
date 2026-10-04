import React from 'react';
import { CheckCircle2, Ticket, Calendar, MapPin, Download, ArrowRight, Share2, Sparkles } from 'lucide-react';
import { Booking, EventItem } from '../lib/api';

interface BookingConfirmationProps {
  booking: Booking;
  event?: EventItem;
  onViewTicket: () => void;
  onGoToBookings: () => void;
  onBrowseMore: () => void;
}

export const BookingConfirmation: React.FC<BookingConfirmationProps> = ({
  booking,
  event,
  onViewTicket,
  onGoToBookings,
  onBrowseMore
}) => {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xl text-center relative overflow-hidden">
        {/* Confirmed Icon */}
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto mb-4 shadow-sm">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <span className="text-xs font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
          Booking Confirmed
        </span>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-3">
          You&apos;re Going to {booking.event_name || event?.name || 'the Event'}!
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Your seat allocation is permanently registered on the server.
        </p>

        {/* Ticket Reference Card */}
        <div className="mt-8 bg-slate-50 border border-slate-200 rounded-2xl p-6 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                Booking Reference
              </span>
              <span className="font-mono text-xl font-bold text-slate-900">
                {booking.booking_ref}
              </span>
            </div>
            <div className="sm:text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                Pass Type
              </span>
              <span className="font-semibold text-slate-800 text-sm">
                {booking.ticket_name || 'Standard Pass'} ({booking.quantity}x)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 text-xs">
            <div>
              <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Date &amp; Time</span>
              </div>
              <span className="font-semibold text-slate-800 block">
                {booking.event_date || event?.date} • {booking.event_time || event?.time}
              </span>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>Venue</span>
              </div>
              <span className="font-semibold text-slate-800 block truncate">
                {booking.event_venue || event?.venue}, {booking.event_city || event?.city}
              </span>
            </div>
          </div>

          {/* SVG QR Code Simulation */}
          <div className="mt-6 pt-6 border-t border-slate-200 flex flex-col items-center">
            <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs">
              <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="120" height="120" fill="white"/>
                {/* Visual QR Code Blocks */}
                <rect x="10" y="10" width="30" height="30" fill="#0f172a" rx="4"/>
                <rect x="16" y="16" width="18" height="18" fill="white" rx="2"/>
                <rect x="20" y="20" width="10" height="10" fill="#0f172a" rx="1"/>

                <rect x="80" y="10" width="30" height="30" fill="#0f172a" rx="4"/>
                <rect x="86" y="16" width="18" height="18" fill="white" rx="2"/>
                <rect x="90" y="20" width="10" height="10" fill="#0f172a" rx="1"/>

                <rect x="10" y="80" width="30" height="30" fill="#0f172a" rx="4"/>
                <rect x="16" y="86" width="18" height="18" fill="white" rx="2"/>
                <rect x="20" y="90" width="10" height="10" fill="#0f172a" rx="1"/>

                {/* Data Matrix Dots */}
                <rect x="48" y="14" width="8" height="8" fill="#0f172a"/>
                <rect x="62" y="18" width="8" height="8" fill="#0f172a"/>
                <rect x="52" y="32" width="16" height="8" fill="#0f172a"/>
                <rect x="48" y="48" width="8" height="16" fill="#0f172a"/>
                <rect x="66" y="52" width="12" height="12" fill="#0f172a"/>
                <rect x="86" y="48" width="18" height="8" fill="#0f172a"/>
                <rect x="88" y="66" width="14" height="14" fill="#0f172a"/>
                <rect x="48" y="74" width="20" height="8" fill="#0f172a"/>
                <rect x="52" y="92" width="14" height="14" fill="#0f172a"/>
                <rect x="74" y="90" width="16" height="8" fill="#0f172a"/>
                <rect x="96" y="90" width="10" height="18" fill="#0f172a"/>
              </svg>
            </div>
            <span className="font-mono text-[10px] text-slate-500 mt-2">
              DIGITAL ENCRYPTION PASS • READY FOR ENTRY
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onViewTicket}
            className="w-full sm:w-auto px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-2"
          >
            <Ticket className="w-4 h-4 text-emerald-400" />
            View Digital Ticket
          </button>
          <button
            onClick={onGoToBookings}
            className="w-full sm:w-auto px-6 py-3 border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors"
          >
            My Bookings
          </button>
          <button
            onClick={onBrowseMore}
            className="w-full sm:w-auto px-6 py-3 text-slate-500 hover:text-slate-800 text-xs font-semibold transition-colors"
          >
            Browse More Events
          </button>
        </div>
      </div>
    </div>
  );
};
