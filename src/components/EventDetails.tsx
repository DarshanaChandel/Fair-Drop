import React from 'react';
import { Calendar, MapPin, Users, ShieldCheck, Ticket, ArrowLeft, ArrowRight, Clock, Building, Sparkles } from 'lucide-react';
import { EventItem, TicketType } from '../lib/api';

interface EventDetailsProps {
  event: EventItem;
  ticketTypes: TicketType[];
  onBack: () => void;
  onJoinDrop: () => void;
  onNormalBook: (ticketType: TicketType) => void;
}

export const EventDetails: React.FC<EventDetailsProps> = ({
  event,
  ticketTypes,
  onBack,
  onJoinDrop,
  onNormalBook
}) => {
  const isHighDemand = event.is_high_demand === 1;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Events
      </button>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Poster & Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Banner Poster */}
          <div className="relative aspect-[16/9] rounded-3xl overflow-hidden bg-slate-900 border border-slate-200 shadow-md">
            <img
              src={event.poster_url}
              alt={event.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />

            {/* High Demand Ribbon */}
            {isHighDemand && (
              <div className="absolute top-4 left-4 px-3.5 py-1.5 rounded-full bg-slate-950/90 backdrop-blur-md text-emerald-400 text-xs font-bold border border-emerald-500/30 flex items-center gap-2 shadow-lg">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Protected by Fair Drop
              </div>
            )}

            <div className="absolute bottom-4 left-4 right-4 text-white">
              <span className="text-xs uppercase font-bold tracking-wider text-emerald-400 block mb-1">
                {event.category}
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {event.name}
              </h1>
            </div>
          </div>

          {/* Description Section */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-900 mb-2">About the Event</h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {event.description}
              </p>
            </div>

            {/* Fair Drop High Demand Context Box */}
            {isHighDemand && (
              <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 space-y-2">
                <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Fair Drop Protection Active
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  This event uses Fair Drop to provide a reliable booking experience during exceptionally high demand. 500 tickets will be allocated honestly to legitimate participants without letting automated bot scripts race ahead.
                </p>
                <div className="pt-2 flex flex-wrap gap-4 text-[11px] font-semibold text-emerald-900">
                  <span>• 500 Total Seats</span>
                  <span>• 50,000 Expected Participants</span>
                  <span>• Server-Authoritative Queue</span>
                </div>
              </div>
            )}

            {/* Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100 text-xs">
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-slate-400 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900 block">Date &amp; Time</span>
                  <span className="text-slate-600">{event.date} • {event.time}</span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900 block">Venue</span>
                  <span className="text-slate-600">{event.venue}, {event.city}</span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Building className="w-4 h-4 text-slate-400 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900 block">Organizer</span>
                  <span className="text-slate-600">{event.organizer}</span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Ticket className="w-4 h-4 text-slate-400 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-900 block">Total Capacity</span>
                  <span className="text-slate-600">{event.total_capacity} Verified Passes</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Ticket Tiers & Booking Action */}
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs sticky top-24">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Pass Options</h3>

            <div className="space-y-3 mb-6">
              {ticketTypes.map((tier) => (
                <div
                  key={tier.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex items-center justify-between"
                >
                  <div>
                    <h4 className="font-bold text-slate-900 text-xs">{tier.name}</h4>
                    <span className="text-[11px] text-slate-500 block">
                      {tier.available_quantity > 0
                        ? `${tier.available_quantity} available`
                        : 'Sold out'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-sm text-slate-900 block">
                      ₹{tier.price.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Primary Action Button */}
            {isHighDemand ? (
              <button
                onClick={onJoinDrop}
                className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl text-sm shadow-md transition-all flex items-center justify-center gap-2 group"
              >
                <span>JOIN THE DROP</span>
                <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-1 transition-transform" />
              </button>
            ) : (
              <button
                onClick={() => onNormalBook(ticketTypes[0])}
                className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl text-sm shadow-md transition-all flex items-center justify-center gap-2 group"
              >
                <span>Select Passes</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            )}

            <div className="mt-4 text-center">
              <span className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Guaranteed genuine ticket allocation
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
