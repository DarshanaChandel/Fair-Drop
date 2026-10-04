import React, { useState, useEffect } from 'react';
import { Clock, ShieldCheck, CreditCard, AlertCircle, CheckCircle, Lock } from 'lucide-react';
import { EventItem, TicketType, Booking, api, User } from '../lib/api';

interface CheckoutModalProps {
  event: EventItem;
  holdData: {
    holdId: string;
    ticketType: TicketType;
    quantity: number;
    expiresAt: string;
    totalPrice: number;
  };
  currentUser: User | null;
  onSuccess: (booking: Booking) => void;
  onCancel: () => void;
  onExpired: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  event,
  holdData,
  currentUser,
  onSuccess,
  onCancel,
  onExpired
}) => {
  const [attendeeName, setAttendeeName] = useState(currentUser?.name || 'Alex Mercer');
  const [attendeeEmail, setAttendeeEmail] = useState(currentUser?.email || 'alex@example.com');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(300);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronized countdown timer based on actual server expiresAt timestamp
  useEffect(() => {
    const target = new Date(holdData.expiresAt).getTime();

    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((target - Date.now()) / 1000));
      setSecondsRemaining(diff);

      if (diff <= 0) {
        onExpired();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [holdData.expiresAt, onExpired]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleConfirmCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const idempotencyKey = `checkout_${holdData.holdId}_${Date.now()}`;

    try {
      let booking: Booking;
      if (holdData.holdId === 'direct') {
        booking = await api.directBook(
          {
            eventId: event.id,
            ticketTypeId: holdData.ticketType.id,
            quantity: holdData.quantity,
            attendeeName
          },
          idempotencyKey
        );
      } else {
        booking = await api.confirmBooking(
          {
            holdId: holdData.holdId,
            attendeeName,
            paymentMethod: 'DEMO_SAFE_PAY'
          },
          idempotencyKey
        );
      }

      onSuccess(booking);
    } catch (err: any) {
      setError(err.message || 'Payment/Checkout failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Hold Timer Alert Header */}
        <div className="bg-amber-50 px-6 py-3 border-b border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <Clock className="w-4 h-4 text-amber-600 animate-pulse" />
            <span>Seats Reserved Temporarily</span>
          </div>
          <span className="font-mono text-xs font-extrabold text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-300">
            {formatTimer(secondsRemaining)}
          </span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleConfirmCheckout} className="p-6">
          <h2 className="text-xl font-bold text-slate-900">
            Review &amp; Confirm Booking
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Safe demo checkout for {event.name}
          </p>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {/* Order Details Breakdown */}
          <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
            <div className="flex justify-between font-medium text-slate-700">
              <span>Event:</span>
              <span className="font-semibold text-slate-900 text-right">{event.name}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Ticket Tier:</span>
              <span className="font-semibold text-slate-900">{holdData.ticketType.name}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Quantity:</span>
              <span className="font-mono font-semibold text-slate-900">{holdData.quantity} Ticket(s)</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Unit Price:</span>
              <span className="font-mono">₹{holdData.ticketType.price.toLocaleString()}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-sm text-slate-900">
              <span>Total Amount:</span>
              <span className="font-mono text-base text-emerald-700">₹{holdData.totalPrice.toLocaleString()}</span>
            </div>
          </div>

          {/* Attendee Details */}
          <div className="mt-5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Attendee Name (Printed on Digital Badge)
              </label>
              <input
                type="text"
                required
                value={attendeeName}
                onChange={(e) => setAttendeeName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Confirmation Email
              </label>
              <input
                type="email"
                required
                value={attendeeEmail}
                onChange={(e) => setAttendeeEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white"
              />
            </div>
          </div>

          {/* Safe Demo Payment Indicator */}
          <div className="mt-5 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/60 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-900">
              <span className="font-semibold block">Demo Verification Environment</span>
              <span className="text-emerald-700 text-[11px]">
                No actual credit card charge required. Click confirm to claim your guaranteed seats.
              </span>
            </div>
          </div>

          {/* Buttons */}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-3 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || secondsRemaining <= 0}
              className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-sm shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4 text-emerald-400" />
              {isSubmitting ? 'Confirming Booking...' : 'Complete & Generate Digital Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
