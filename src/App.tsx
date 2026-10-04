import React, { useState, useEffect } from 'react';
import {
  Search,
  Sparkles,
  Ticket,
  Calendar,
  MapPin,
  ShieldCheck,
  ArrowRight,
  TrendingUp,
  Filter,
  CheckCircle2,
  Users
} from 'lucide-react';
import {
  api,
  EventItem,
  TicketType,
  QueueStatus,
  Booking,
  User,
  getStoredToken,
  setStoredToken,
  clearStoredToken
} from './lib/api';
import { Navbar } from './components/Navbar';
import { EventCard } from './components/EventCard';
import { EventDetails } from './components/EventDetails';
import { WaitingRoom } from './components/WaitingRoom';
import { TicketSelection } from './components/TicketSelection';
import { CheckoutModal } from './components/CheckoutModal';
import { BookingConfirmation } from './components/BookingConfirmation';
import { DigitalTicketModal } from './components/DigitalTicketModal';
import { HowItWorksModal } from './components/HowItWorksModal';
import { AuthModal } from './components/AuthModal';
import { MyBookingsView } from './components/MyBookingsView';
import { AdminPortal } from './components/admin/AdminPortal';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<string>('home');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [selectedEventTickets, setSelectedEventTickets] = useState<TicketType[]>([]);
  const [activeQueueStatus, setActiveQueueStatus] = useState<QueueStatus | null>(null);
  const [activeHoldData, setActiveHoldData] = useState<any>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);
  const [ticketModalBooking, setTicketModalBooking] = useState<Booking | null>(null);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);

  // Search & Filter state
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Initialize user session & events
  useEffect(() => {
    checkCurrentUser();
    loadEvents();
  }, []);

  const checkCurrentUser = async () => {
    try {
      const token = getStoredToken();
      if (token) {
        const res = await api.getCurrentUser();
        if (res.user) {
          setCurrentUser(res.user);
          return;
        }
      }
      // Initialize verified demo user session on initial visit
      const demoRes = await api.demoLogin('USER');
      if (demoRes.token) {
        setStoredToken(demoRes.token);
        setCurrentUser(demoRes.user);
      }
    } catch (e) {
      // ignore
    }
  };

  const loadEvents = async () => {
    try {
      const res = await api.getEvents();
      setEvents(res.events);
    } catch (e) {
      console.error('Failed to load events:', e);
    }
  };

  const loadMyBookings = async () => {
    try {
      const res = await api.getMyBookings();
      setMyBookings(res.bookings);
    } catch (e) {
      // ignore
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (e) {
      // ignore
    }
    clearStoredToken();
    setCurrentUser(null);
    setCurrentView('home');
    setNotification('Logged out successfully');
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSelectEvent = async (event: EventItem) => {
    setSelectedEvent(event);
    try {
      const res = await api.getEventDetails(event.id);
      setSelectedEventTickets(res.ticketTypes);
      setCurrentView('event-details');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      console.error('Failed to load event details:', e);
    }
  };

  // Join the Drop Queue (Flagship TECHFEST)
  const handleJoinDrop = async () => {
    if (!currentUser) {
      setAuthMode('login');
      setIsAuthOpen(true);
      return;
    }
    if (!selectedEvent) return;

    try {
      const queueRes = await api.joinQueue(selectedEvent.id);
      setActiveQueueStatus(queueRes);
      if (queueRes.status === 'ADMITTED') {
        setCurrentView('ticket-selection');
      } else {
        setCurrentView('waiting-room');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setNotification(err.message || 'Failed to join drop');
      setTimeout(() => setNotification(null), 4000);
    }
  };

  // Normal event direct booking
  const handleNormalBook = async (ticketType: TicketType) => {
    if (!currentUser) {
      setAuthMode('login');
      setIsAuthOpen(true);
      return;
    }
    try {
      const hold = await api.createHold({
        eventId: ticketType.event_id,
        ticketTypeId: ticketType.id,
        quantity: 1
      });
      setActiveHoldData({
        holdId: hold.holdId,
        ticketType,
        quantity: 1,
        expiresAt: hold.expiresAt,
        totalPrice: hold.totalPrice
      });
      setIsCheckoutOpen(true);
    } catch (err: any) {
      setNotification(err.message || 'Unable to hold ticket');
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleAdmitted = () => {
    setCurrentView('ticket-selection');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleProceedToCheckout = (holdData: any) => {
    setActiveHoldData(holdData);
    setIsCheckoutOpen(true);
  };

  const handleBookingConfirmed = (booking: Booking) => {
    setIsCheckoutOpen(false);
    setConfirmedBooking(booking);
    setCurrentView('confirmation');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigate = (view: string, data?: any) => {
    setCurrentView(view);
    if (view === 'my-bookings') {
      loadMyBookings();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Categories Filter List
  const categories = ['All', 'Technology', 'Music', 'Sports', 'Comedy', 'Workshop', 'Conference', 'College Festival'];

  const filteredEvents = events.filter((e) => {
    const matchesCat = selectedCategory === 'All' || e.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.venue.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const flagshipEvent = events.find((e) => e.is_high_demand === 1) || events[0];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-top-2 duration-200">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Main Navbar */}
      <Navbar
        user={currentUser}
        currentView={currentView}
        onNavigate={handleNavigate}
        onOpenAuth={(mode) => {
          setAuthMode(mode || 'login');
          setIsAuthOpen(true);
        }}
        onOpenHowItWorks={() => setIsHowItWorksOpen(true)}
        onLogout={handleLogout}
      />

      {/* ADMIN SENTINEL PORTAL VIEW */}
      {currentView === 'admin' ? (
        <AdminPortal
          currentUser={currentUser}
          onBackToApp={() => setCurrentView('home')}
          onUserChange={(newUser) => setCurrentUser(newUser)}
        />
      ) : (
        <div className="flex-1">
          {/* 1. HOME VIEW */}
          {currentView === 'home' && (
            <div className="space-y-12 pb-16">
              {/* Flagship Hero Banner (TECHFEST 2026) */}
              {flagshipEvent && (
                <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
                  <div
                    onClick={() => handleSelectEvent(flagshipEvent)}
                    className="group relative rounded-3xl overflow-hidden bg-slate-950 border border-slate-800 shadow-2xl cursor-pointer"
                  >
                    <div className="relative aspect-[21/9] min-h-[360px] w-full">
                      <img
                        src={flagshipEvent.poster_url}
                        alt={flagshipEvent.name}
                        className="w-full h-full object-cover opacity-75 group-hover:scale-102 transition-transform duration-700"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />

                      <div className="absolute bottom-6 left-6 right-6 sm:bottom-10 sm:left-10 sm:right-10 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
                        <div className="max-w-2xl space-y-3">
                          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30 backdrop-blur-md">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            Flagship Drop • 500 Seats Available
                          </div>

                          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                            {flagshipEvent.name}
                          </h1>

                          <p className="text-xs sm:text-sm text-slate-300 line-clamp-2 leading-relaxed">
                            {flagshipEvent.description}
                          </p>

                          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-400 pt-1">
                            <span className="flex items-center gap-1.5 text-white">
                              <Calendar className="w-4 h-4 text-emerald-400" />
                              {flagshipEvent.date} • {flagshipEvent.time}
                            </span>
                            <span className="flex items-center gap-1.5 text-white">
                              <MapPin className="w-4 h-4 text-emerald-400" />
                              {flagshipEvent.venue}, {flagshipEvent.city}
                            </span>
                          </div>
                        </div>

                        <div className="shrink-0">
                          <button
                            type="button"
                            className="px-6 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-2xl text-xs sm:text-sm shadow-lg transition-transform group-hover:scale-105 flex items-center gap-2"
                          >
                            <span>JOIN THE DROP</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Events Catalog Grid */}
              <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                      Featured &amp; Upcoming Events
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Authentic ticket passes backed by server-authoritative fair queues
                    </p>
                  </div>

                  {/* Search Bar */}
                  <div className="relative w-full md:w-72">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search event, city, artist..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-2xs"
                    />
                  </div>
                </div>

                {/* Category Pills */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                        selectedCategory === cat
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Event Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-2">
                  {filteredEvents.map((evt) => (
                    <EventCard
                      key={evt.id}
                      event={evt}
                      onSelect={handleSelectEvent}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* 2. ALL EVENTS VIEW */}
          {currentView === 'events' && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                  All Events
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Browse and reserve verified tickets across all categories
                </p>
              </div>

              {/* Filter Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2 overflow-x-auto w-full pb-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                        selectedCategory === cat
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search events..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-4">
                {filteredEvents.map((evt) => (
                  <EventCard
                    key={evt.id}
                    event={evt}
                    onSelect={handleSelectEvent}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 3. EVENT DETAILS VIEW */}
          {currentView === 'event-details' && selectedEvent && (
            <EventDetails
              event={selectedEvent}
              ticketTypes={selectedEventTickets}
              onBack={() => setCurrentView('home')}
              onJoinDrop={handleJoinDrop}
              onNormalBook={handleNormalBook}
            />
          )}

          {/* 4. WAITING ROOM VIEW */}
          {currentView === 'waiting-room' && selectedEvent && activeQueueStatus && (
            <WaitingRoom
              event={selectedEvent}
              initialQueueStatus={activeQueueStatus}
              onAdmitted={handleAdmitted}
              onLeave={() => setCurrentView('home')}
            />
          )}

          {/* 5. TICKET SELECTION VIEW */}
          {currentView === 'ticket-selection' && selectedEvent && (
            <TicketSelection
              event={selectedEvent}
              ticketTypes={selectedEventTickets}
              onProceedToCheckout={handleProceedToCheckout}
              onCancel={() => setCurrentView('home')}
            />
          )}

          {/* 6. BOOKING CONFIRMATION VIEW */}
          {currentView === 'confirmation' && confirmedBooking && (
            <BookingConfirmation
              booking={confirmedBooking}
              event={selectedEvent || undefined}
              onViewTicket={() => setTicketModalBooking(confirmedBooking)}
              onGoToBookings={() => {
                loadMyBookings();
                setCurrentView('my-bookings');
              }}
              onBrowseMore={() => setCurrentView('home')}
            />
          )}

          {/* 7. MY BOOKINGS VIEW */}
          {currentView === 'my-bookings' && (
            <MyBookingsView
              bookings={myBookings}
              onViewTicket={(b) => setTicketModalBooking(b)}
              onBrowseEvents={() => setCurrentView('events')}
            />
          )}

          {/* 8. PROFILE VIEW */}
          {currentView === 'profile' && currentUser && (
            <div className="max-w-2xl mx-auto px-4 py-12">
              <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white font-extrabold text-xl flex items-center justify-center">
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{currentUser.name}</h2>
                    <p className="text-xs text-slate-500">{currentUser.email}</p>
                    <span className="inline-block mt-1 text-[10px] uppercase font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {currentUser.role === 'ADMIN' ? 'Sentinel Administrator' : 'Verified Member'}
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 space-y-3 text-xs">
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span className="text-slate-500">Account ID:</span>
                    <span className="font-mono font-medium text-slate-900">{currentUser.id}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span className="text-slate-500">Allocation Verification Status:</span>
                    <span className="text-emerald-700 font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" /> Active &amp; Verified
                    </span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Device Telemetry:</span>
                    <span className="text-slate-700">Normal (No automation flags)</span>
                  </div>
                </div>

                <div className="pt-4 flex justify-between">
                  <button
                    onClick={() => {
                      loadMyBookings();
                      setCurrentView('my-bookings');
                    }}
                    className="px-4 py-2 bg-slate-900 text-white font-semibold text-xs rounded-xl shadow-xs hover:bg-slate-800 transition-colors"
                  >
                    View My Passes
                  </button>
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2 border border-slate-200 text-red-600 hover:bg-red-50 text-xs font-semibold rounded-xl transition-colors"
                  >
                    Log Out
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer (Customer Portal Only) */}
      {currentView !== 'admin' && (
        <footer className="bg-white border-t border-slate-200 mt-auto py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-slate-900">FAIR DROP</span>
              <span>• Selling 500 Seats to 50,000 People Without Letting Bots Win.</span>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsHowItWorksOpen(true)}
                className="hover:text-slate-900 transition-colors"
              >
                Fairness Standard
              </button>
              <button
                onClick={() => setCurrentView('admin')}
                className="hover:text-indigo-600 transition-colors font-medium"
              >
                Sentinel Console
              </button>
              <span>&copy; 2026 Fair Drop Technologies</span>
            </div>
          </div>
        </footer>
      )}

      {/* Modals */}
      <AuthModal
        isOpen={isAuthOpen}
        initialMode={authMode}
        onClose={() => setIsAuthOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          setNotification(`Welcome back, ${user.name}`);
          setTimeout(() => setNotification(null), 3000);
        }}
      />

      <HowItWorksModal
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
      />

      {isCheckoutOpen && selectedEvent && activeHoldData && (
        <CheckoutModal
          event={selectedEvent}
          holdData={activeHoldData}
          currentUser={currentUser}
          onSuccess={handleBookingConfirmed}
          onCancel={() => setIsCheckoutOpen(false)}
          onExpired={() => {
            setIsCheckoutOpen(false);
            setNotification('Ticket hold has expired. Please select passes again.');
            setTimeout(() => setNotification(null), 4000);
          }}
        />
      )}

      <DigitalTicketModal
        booking={ticketModalBooking}
        onClose={() => setTicketModalBooking(null)}
      />
    </div>
  );
}
