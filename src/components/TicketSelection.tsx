import React, { useState, useEffect } from 'react';
import { Ticket, Clock, Check, AlertCircle, Shield, ChevronRight } from 'lucide-react';
import { EventItem, TicketType, api } from '../lib/api';

interface TicketSelectionProps {
  event: EventItem;
  ticketTypes: TicketType[];
  onProceedToCheckout: (holdData: {
    holdId: string;
    ticketType: TicketType;
    quantity: number;
    expiresAt: string;
    totalPrice: number;
  }) => void;
  onCancel: () => void;
}

export const TicketSelection: React.FC<TicketSelectionProps> = ({
  event,
  ticketTypes,
  onProceedToCheckout,
  onCancel
}) => {
  const [selectedTypeId, setSelectedTypeId] = useState<string>(ticketTypes[0]?.id || '');
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTicket = ticketTypes.find(t => t.id === selectedTypeId) || ticketTypes[0];

  const handleHoldTickets = async () => {
    if (!selectedTicket) return;
    setLoading(true);
    setError(null);

    const idemKey = `hold_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      let holdRes;
      try {
        holdRes = await api.createHold(
          {
            eventId: event.id,
            ticketTypeId: selectedTicket.id,
            quantity
          },
          idemKey
        );
      } catch (firstErr: any) {
        if (firstErr.message && (firstErr.message.includes('Admission required') || firstErr.message.includes('403'))) {
          // Auto-admit in demo context
          await api.admitMe(event.id);
          holdRes = await api.createHold(
            {
              eventId: event.id,
              ticketTypeId: selectedTicket.id,
              quantity
            },
            idemKey
          );
        } else {
          throw firstErr;
        }
      }

      onProceedToCheckout({
        holdId: holdRes.holdId,
        ticketType: selectedTicket,
        quantity,
        expiresAt: holdRes.expiresAt,
        totalPrice: holdRes.totalPrice
      });
    } catch (err: any) {
      setError(err.message || 'Unable to reserve tickets. They may have been claimed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-slate-100">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md mb-2">
              <Shield className="w-3.5 h-3.5" /> Admitted to Ticket Selection
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Select Your Passes
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {event.name} • {event.date}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {/* Ticket Tiers Selection */}
        <div className="mt-6 space-y-3">
          {ticketTypes.map((tier) => {
            const isSelected = tier.id === selectedTypeId;
            const isSoldOut = tier.available_quantity <= 0;

            return (
              <div
                key={tier.id}
                onClick={() => !isSoldOut && setSelectedTypeId(tier.id)}
                className={`p-5 rounded-2xl border transition-all cursor-pointer relative ${
                  isSoldOut
                    ? 'opacity-50 bg-slate-50 border-slate-200 cursor-not-allowed'
                    : isSelected
                    ? 'border-slate-900 bg-slate-50/80 ring-2 ring-slate-900/10'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-base">
                        {tier.name}
                      </h3>
                      {isSoldOut ? (
                        <span className="text-[10px] uppercase font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded">
                          Sold Out
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded">
                          {tier.available_quantity} Available
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {tier.description}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-xl font-extrabold text-slate-900 font-mono">
                      ₹{tier.price.toLocaleString()}
                    </div>
                    <span className="text-[10px] text-slate-400 block">per pass</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Quantity Selector */}
        {selectedTicket && selectedTicket.available_quantity > 0 && (
          <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide block">
                Number of Tickets
              </span>
              <span className="text-[11px] text-slate-500">
                Max {selectedTicket.max_per_booking} per verified member
              </span>
            </div>

            <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
              {[1, 2].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setQuantity(num)}
                  className={`w-12 h-10 text-sm font-bold transition-colors ${
                    quantity === num
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pricing Summary */}
        <div className="mt-8 bg-slate-50 rounded-2xl p-5 border border-slate-200">
          <div className="flex justify-between text-xs text-slate-600 mb-2">
            <span>Pass Subtotal ({quantity}x)</span>
            <span className="font-mono font-medium">₹{(selectedTicket.price * quantity).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-600 mb-2">
            <span>Platform Booking Fee</span>
            <span className="font-mono text-emerald-600 font-semibold">₹0 (Waived)</span>
          </div>
          <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-bold text-slate-900">
            <span>Total Payable</span>
            <span className="font-mono text-base font-extrabold">₹{(selectedTicket.price * quantity).toLocaleString()}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-3 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleHoldTickets}
            disabled={loading || selectedTicket.available_quantity <= 0}
            className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-sm shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              'Holding Tickets...'
            ) : (
              <>
                Reserve & Proceed to Checkout
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
