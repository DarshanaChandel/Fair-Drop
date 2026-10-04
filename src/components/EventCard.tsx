import React from 'react';
import { Calendar, MapPin, Ticket, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';
import { EventItem } from '../lib/api';

interface EventCardProps {
  event: EventItem;
  onSelect: (event: EventItem) => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, onSelect }) => {
  const isHighDemand = event.is_high_demand === 1;

  return (
    <div
      onClick={() => onSelect(event)}
      className="group bg-white rounded-2xl border border-slate-200/90 hover:border-slate-300 shadow-xs hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col cursor-pointer"
    >
      {/* Poster Image */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-100">
        <img
          src={event.poster_url}
          alt={event.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />

        {/* High Demand / Fair Drop Badge */}
        {isHighDemand ? (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-950/85 backdrop-blur-md text-emerald-400 text-[11px] font-bold border border-emerald-500/30 shadow-md">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Fair Drop Flagship
          </div>
        ) : (
          <div className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full bg-slate-900/70 backdrop-blur-md text-white text-[11px] font-medium">
            {event.category}
          </div>
        )}

        {/* Starting Price Pill */}
        <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg bg-white/95 backdrop-blur-md text-slate-900 text-xs font-bold font-mono shadow-sm">
          From ₹{event.startingPrice.toLocaleString()}
        </div>
      </div>

      {/* Card Info */}
      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="font-extrabold text-base text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-1">
            {event.name}
          </h3>
          <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
            {event.description}
          </p>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{event.date} • {event.time}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{event.venue}, {event.city}</span>
          </div>
        </div>

        {/* Button Action */}
        <div className="mt-4 pt-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-500">
            {event.availableTickets > 0 ? (
              <span className="text-emerald-700 font-medium">{event.availableTickets} tickets remaining</span>
            ) : (
              <span className="text-red-600 font-medium">Sold Out</span>
            )}
          </span>

          <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">
            {isHighDemand ? 'Join The Drop' : 'Book Passes'}
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
          </span>
        </div>
      </div>
    </div>
  );
};
