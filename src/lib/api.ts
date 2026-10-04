// API Client and state management helpers for Fair Drop

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
}

export interface EventItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  poster_url: string;
  date: string;
  time: string;
  venue: string;
  city: string;
  organizer: string;
  is_high_demand: number;
  total_capacity: number;
  status: 'DRAFT' | 'OPEN' | 'LIVE_DROP' | 'CLOSED';
  startingPrice: number;
  availableTickets: number;
  isSoldOut: boolean;
  settings_json?: string;
}

export interface TicketType {
  id: string;
  event_id: string;
  name: string;
  description: string;
  price: number;
  total_quantity: number;
  available_quantity: number;
  held_quantity: number;
  confirmed_quantity: number;
  max_per_booking: number;
}

export interface QueueStatus {
  token: string;
  fairDropId: string;
  position: number;
  participantsAhead: number;
  totalWaiting: number;
  status: 'WAITING' | 'ADMITTED' | 'EXPIRED' | 'CANCELLED';
  admittedAt?: string;
  expiresAt?: string;
  connectionStatus: 'CONNECTED' | 'RECONNECTING' | 'SESSION_RESTORED';
  reconnectCount: number;
}

export interface Booking {
  id: string;
  booking_ref: string;
  event_id: string;
  user_id: string;
  ticket_type_id: string;
  quantity: number;
  total_amount: number;
  currency: string;
  status: 'CONFIRMED' | 'PENDING' | 'CANCELLED';
  payment_method: string;
  qr_code_data: string;
  created_at: string;
  event_name?: string;
  event_date?: string;
  event_time?: string;
  event_venue?: string;
  event_city?: string;
  event_poster?: string;
  ticket_name?: string;
  seats?: string[];
}

export interface CaptchaData {
  challengeId: string;
  type: 'arithmetic' | 'text';
  question: string;
  svgData: string;
  expiresAt: string;
}

const TOKEN_KEY = 'fairdrop_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit & { idempotencyKey?: string } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  const response = await fetch(endpoint, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data as T;
}

// API Methods
export const api = {
  // Auth
  getCaptcha: (type: 'arithmetic' | 'text' = 'arithmetic') =>
    apiRequest<CaptchaData>(`/api/captcha?type=${type}`),

  login: (body: { email: string; password: string; captchaId: string; captchaAnswer: string }) =>
    apiRequest<{ message: string; token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  demoLogin: (role: 'USER' | 'ADMIN' = 'USER') =>
    apiRequest<{ message: string; token: string; user: User }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ role })
    }),

  signup: (body: { name: string; email: string; password: string; captchaId?: string; captchaAnswer?: string }) =>
    apiRequest<{ message: string; token: string; user: User }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(body)
    }),

  getCurrentUser: () =>
    apiRequest<{ user: User | null; session?: { id: string; expiresAt: string } }>('/api/auth/me'),

  logout: () =>
    apiRequest<{ message: string }>('/api/auth/logout', { method: 'POST' }),

  // Events
  getEvents: (category?: string, search?: string) => {
    const params = new URLSearchParams();
    if (category && category !== 'All') params.set('category', category);
    if (search) params.set('search', search);
    return apiRequest<{ events: EventItem[] }>(`/api/events?${params.toString()}`);
  },

  getEventDetails: (slugOrId: string) =>
    apiRequest<{ event: EventItem; ticketTypes: TicketType[] }>(`/api/events/${slugOrId}`),

  // Queue
  joinQueue: (eventId: string) =>
    apiRequest<QueueStatus>('/api/queue/join', {
      method: 'POST',
      body: JSON.stringify({ eventId })
    }),

  admitMe: (eventId: string) =>
    apiRequest<QueueStatus>('/api/queue/admit-me', {
      method: 'POST',
      body: JSON.stringify({ eventId })
    }),

  getQueueStatus: (eventId: string) =>
    apiRequest<QueueStatus>(`/api/queue/status?eventId=${encodeURIComponent(eventId)}`),

  // Inventory & Bookings
  createHold: (body: { eventId: string; ticketTypeId: string; quantity: number }, idempotencyKey?: string) =>
    apiRequest<{ holdId: string; ticketTypeId: string; quantity: number; expiresAt: string; totalPrice: number }>(
      '/api/inventory/hold',
      {
        method: 'POST',
        body: JSON.stringify(body),
        idempotencyKey
      }
    ),

  confirmBooking: (body: { holdId: string; attendeeName?: string; paymentMethod?: string }, idempotencyKey?: string) =>
    apiRequest<Booking>('/api/bookings/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey
    }),

  directBook: (body: { eventId: string; ticketTypeId: string; quantity: number; attendeeName?: string }, idempotencyKey?: string) =>
    apiRequest<Booking>('/api/bookings/direct', {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey
    }),

  getMyBookings: () =>
    apiRequest<{ bookings: Booking[] }>('/api/bookings/my'),

  getBookingDetails: (id: string) =>
    apiRequest<{ booking: Booking; items: Array<{ id: string; seat_number: string; price: number; attendee_name: string }> }>(`/api/bookings/${id}`),

  // Admin Sentinel
  getAdminOverview: () =>
    apiRequest<any>('/api/admin/overview'),

  getAdminEvents: () =>
    apiRequest<{ events: EventItem[] }>('/api/admin/events'),

  updateEventStatus: (id: string, status: string) =>
    apiRequest<any>(`/api/admin/events/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status })
    }),

  admitDropBatch: (eventId: string, batchSize?: number) =>
    apiRequest<{ admittedCount: number; remainingWaiting: number }>('/api/admin/drop/admit-batch', {
      method: 'POST',
      body: JSON.stringify({ eventId, batchSize })
    }),

  getAdminInventory: (eventId: string) =>
    apiRequest<any>(`/api/admin/inventory/${eventId}`),

  releaseAdminHold: (holdId: string) =>
    apiRequest<any>('/api/admin/inventory/release-hold', {
      method: 'POST',
      body: JSON.stringify({ holdId })
    }),

  getAdminBookings: () =>
    apiRequest<{ bookings: any[] }>('/api/admin/bookings'),

  getAdminSecurityEvents: () =>
    apiRequest<{ events: any[] }>('/api/admin/security/events'),

  restrictSession: (sessionId: string, reason?: string) =>
    apiRequest<any>('/api/admin/security/restrict', {
      method: 'POST',
      body: JSON.stringify({ sessionId, reason })
    }),

  unrestrictSession: (sessionId: string) =>
    apiRequest<any>('/api/admin/security/unrestrict', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    }),

  getAdminRules: () =>
    apiRequest<{ rules: any[] }>('/api/admin/rules'),

  updateAdminRule: (key: string, value: string, isActive: boolean) =>
    apiRequest<any>(`/api/admin/rules/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, isActive })
    }),

  getAdminSystemHealth: () =>
    apiRequest<any>('/api/admin/system/health'),

  runVerificationTests: () =>
    apiRequest<{ total: number; passed: number; failed: number; results: any[] }>('/api/admin/system/run-tests', {
      method: 'POST'
    }),

  // Adversarial Simulation & Fairness Lab
  startSimulation: (config: any) =>
    apiRequest<any>('/api/admin/simulation/start', {
      method: 'POST',
      body: JSON.stringify(config)
    }),

  stopSimulation: () =>
    apiRequest<any>('/api/admin/simulation/stop', { method: 'POST' }),

  getSimulationProgress: () =>
    apiRequest<any>('/api/admin/simulation/progress'),

  getFairnessReport: (runId?: string) =>
    apiRequest<any>(`/api/admin/simulation/report${runId ? `?runId=${runId}` : ''}`)
};
