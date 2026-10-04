import React, { useState } from 'react';
import { Ticket, Calendar, MapPin, QrCode, ArrowRight, ExternalLink } from 'lucide-react';
import { Booking } from '../lib/api';

interface MyBookingsViewProps {
  bookings: Booking[];
  onViewTicket: (booking: Booking) => void;
  onBrowseEvents: () => void;
}

export const MyBookingsView: React.FC<MyBookingsViewProps> = ({
  bookings,
  onViewTicket,
  onBrowseEvents
}) => {
  const [tab, setTab] = useState<'upcoming' | 'completed' | 'cancelled'>('upcoming');

  const filteredBookings = bookings.filter((b) => {
    if (tab === 'cancelled') return b.status === 'CANCELLED';
    // For demo purposes, confirmed bookings are listed as upcoming
    return b.status === 'CONFIRMED';
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      {/* Title & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            My Bookings &amp; Tickets
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Your authenticated passes with cryptographic server signatures
          </p>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          {[
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'completed', label: 'Completed' },
            { id: 'cancelled', label: 'Cancelled' }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                tab === t.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bookings List */}
      <div className="mt-6 space-y-4">
        {filteredBookings.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-3xl border border-slate-200">
            <Ticket className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="font-bold text-slate-800 text-sm">No passes found in this tab</h3>
            <p className="text-xs text-slate-500 mt-1">
              Check out upcoming drops to reserve your verified passes.
            </p>
            <button
              onClick={onBrowseEvents}
              className="mt-4 px-4 py-2 bg-slate-900 text-white font-semibold text-xs rounded-xl shadow-xs hover:bg-slate-800 transition-colors"
            >
              Browse Events
            </button>
          </div>
        ) : (
          filteredBookings.map((b) => (
            <div
              key={b.id}
              className="p-6 bg-white rounded-2xl border border-slate-200 hover:border-slate-300 shadow-xs hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-6"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-700">
                    {b.booking_ref}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase">
                    {b.status}
                  </span>
                </div>

                <h3 className="text-base font-bold text-slate-900">
                  {b.event_name || 'Event Booking'}
                </h3>

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {b.event_date} • {b.event_time}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    {b.event_venue}, {b.event_city}
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-slate-700">
                    <Ticket className="w-3.5 h-3.5 text-slate-400" />
                    {b.ticket_name} ({b.quantity}x)
                  </span>
                </div>
              </div>

              {/* Action */}
              <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 shrink-0">
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Paid Amount</span>
                  <span className="font-mono font-bold text-sm text-slate-900">₹{b.total_amount.toLocaleString()}</span>
                </div>

                <button
                  onClick={() => onViewTicket(b)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-colors"
                >
                  <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                  View Ticket
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
