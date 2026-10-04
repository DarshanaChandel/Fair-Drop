import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { getDb, query, queryOne, run, withTransaction } from './src/server/db.js';
import {
  createCaptchaChallenge,
  verifyCaptcha,
  hashPassword,
  createSession,
  getSessionFromRequest,
  authMiddleware,
  requireAuth,
  requireAdmin
} from './src/server/auth.js';
import {
  createRateLimiter,
  getClientIp,
  evaluateSessionRisk,
  recordCaptchaFailure,
  restrictSession,
  unrestrictSession,
  liveSecurityStats,
  logSecurityEvent
} from './src/server/security.js';
import {
  joinDropQueue,
  getQueueStatus,
  processAdmissionBatch,
  subscribeToQueue
} from './src/server/queue.js';
import {
  createTicketHold,
  confirmBookingFromHold,
  startHoldWorker
} from './src/server/inventory.js';
import {
  startSimulation,
  stopSimulation,
  getCurrentSimulationProgress,
  getFairnessReportData
} from './src/server/simulation.js';
import { runAllTests } from './tests/fairdrop.test.js';

const app = express();
const port = 3000;

app.use(express.json());
app.use(authMiddleware);

// Initialize DB and background workers
await getDb();
startHoldWorker(1500);

// Auto admission background loop for LIVE_DROP events
setInterval(async () => {
  try {
    const liveDrops = query<{ id: string }>('SELECT id FROM events WHERE status = "LIVE_DROP" AND is_high_demand = 1');
    for (const evt of liveDrops) {
      await processAdmissionBatch(evt.id, 10);
    }
  } catch (e) {
    // ignore
  }
}, 4000);

// Latency & RPS tracking middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const dur = Date.now() - start;
    liveSecurityStats.p95Latencies.push(dur);
    if (liveSecurityStats.p95Latencies.length > 200) {
      liveSecurityStats.p95Latencies.shift();
    }
  });
  next();
});

// ==========================================
// 1. AUTH & CAPTCHA ENDPOINTS
// ==========================================

// Rate limit for captcha generation (30/min)
const captchaLimiter = createRateLimiter({
  keyPrefix: 'rl_cap',
  limit: 30,
  windowMs: 60000,
  actionName: 'CAPTCHA_GENERATION'
});

app.get('/api/captcha', captchaLimiter, (req: Request, res: Response) => {
  const type = (req.query.type as 'text' | 'arithmetic') || 'arithmetic';
  const challenge = createCaptchaChallenge(type);
  res.json({
    challengeId: challenge.id,
    type: challenge.challenge_type,
    question: challenge.question,
    svgData: challenge.svg_data,
    expiresAt: challenge.expires_at
  });
});

// Rate limit for login (6/min)
const loginLimiter = createRateLimiter({
  keyPrefix: 'rl_login',
  limit: 8,
  windowMs: 60000,
  actionName: 'USER_LOGIN'
});

app.post('/api/auth/login', loginLimiter, (req: Request, res: Response) => {
  const { email, password, captchaId, captchaAnswer } = req.body;
  const ip = getClientIp(req);
  const sessionId = (req as any).session?.id || `ip_${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  // Server-authoritative CAPTCHA verification
  if (!captchaId || !captchaAnswer) {
    recordCaptchaFailure(sessionId, ip);
    res.status(400).json({ error: 'CAPTCHA verification is required. Please solve the challenge.' });
    return;
  }

  const capResult = verifyCaptcha(captchaId, captchaAnswer);
  if (!capResult.valid) {
    recordCaptchaFailure(sessionId, ip);
    res.status(400).json({ error: capResult.error || 'CAPTCHA verification failed.' });
    return;
  }

  const user = queryOne<{
    id: string;
    email: string;
    password_hash: string;
    name: string;
    role: string;
  }>('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);

  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const passwordHash = hashPassword(password);
  if (passwordHash !== user.password_hash) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const session = createSession(user.id, req);
  res.json({
    message: 'Login successful',
    token: session.token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  });
});

// Demo login endpoint for instant test authentication as USER or ADMIN
app.post('/api/auth/demo-login', (req: Request, res: Response) => {
  const { role = 'USER' } = req.body;
  const targetEmail = role === 'ADMIN' ? 'admin@fairdrop.io' : 'alex@example.com';
  const user = queryOne<{
    id: string;
    email: string;
    name: string;
    role: string;
  }>('SELECT id, email, name, role FROM users WHERE email = ?', [targetEmail]);

  if (!user) {
    res.status(404).json({ error: 'Demo user not found' });
    return;
  }

  const session = createSession(user.id, req);
  res.json({
    message: 'Demo login successful',
    token: session.token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  });
});

app.post('/api/auth/signup', (req: Request, res: Response) => {
  const { name, email, password, captchaId, captchaAnswer } = req.body;
  const ip = getClientIp(req);
  const sessionId = (req as any).session?.id || `ip_${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email, and password are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  // Validate CAPTCHA
  if (captchaId && captchaAnswer) {
    const capResult = verifyCaptcha(captchaId, captchaAnswer);
    if (!capResult.valid) {
      recordCaptchaFailure(sessionId, ip);
      res.status(400).json({ error: capResult.error || 'CAPTCHA verification failed.' });
      return;
    }
  }

  const existing = queryOne('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  if (existing) {
    res.status(400).json({ error: 'An account with this email already exists' });
    return;
  }

  const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const passHash = hashPassword(password);
  const now = new Date().toISOString();

  run(`
    INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'USER', ?, ?)
  `, [userId, email.trim().toLowerCase(), passHash, name.trim(), now, now]);

  const session = createSession(userId, req);
  res.json({
    message: 'Account created successfully',
    token: session.token,
    user: {
      id: userId,
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: 'USER'
    }
  });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const user = (req as any).user;
  const session = (req as any).session;
  if (!user || !session) {
    res.json({ user: null });
    return;
  }
  res.json({
    user,
    session: {
      id: session.id,
      expiresAt: session.expires_at
    }
  });
});

app.post('/api/auth/logout', requireAuth, (req: Request, res: Response) => {
  const session = (req as any).session;
  if (session) {
    run('UPDATE sessions SET status = "REVOKED" WHERE id = ?', [session.id]);
  }
  res.json({ message: 'Logged out successfully' });
});

// ==========================================
// 2. EVENTS ENDPOINTS (CUSTOMER)
// ==========================================

app.get('/api/events', (req: Request, res: Response) => {
  const { category, search } = req.query;
  let sql = 'SELECT * FROM events WHERE status != "DRAFT" AND id NOT LIKE "evt_race_%"';
  const params: any[] = [];

  if (category && category !== 'All') {
    sql += ' AND category = ?';
    params.push(category);
  }

  if (search && typeof search === 'string') {
    sql += ' AND (name LIKE ? OR city LIKE ? OR venue LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  sql += ' ORDER BY is_high_demand DESC, date ASC';
  const events = query(sql, params);

  // Attach starting price and availability summary for each
  const eventsWithDetails = events.map(evt => {
    const tts = query<{ price: number; available_quantity: number }>('SELECT price, available_quantity FROM ticket_types WHERE event_id = ?', [evt.id]);
    const minPrice = tts.length > 0 ? Math.min(...tts.map(t => t.price)) : 0;
    const totalAvail = tts.reduce((sum, t) => sum + (t.available_quantity || 0), 0);
    return {
      ...evt,
      startingPrice: minPrice,
      availableTickets: totalAvail,
      isSoldOut: totalAvail === 0
    };
  });

  res.json({ events: eventsWithDetails });
});

app.get('/api/events/:slugOrId', (req: Request, res: Response) => {
  const param = req.params.slugOrId;
  const event = queryOne<any>('SELECT * FROM events WHERE id = ? OR slug = ?', [param, param]);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const ticketTypes = query<any>('SELECT * FROM ticket_types WHERE event_id = ?', [event.id]);
  res.json({
    event,
    ticketTypes
  });
});

// ==========================================
// 3. FAIR DROP QUEUE & ADMISSION (CUSTOMER)
// ==========================================

const queueJoinLimiter = createRateLimiter({
  keyPrefix: 'rl_drop_join',
  limit: 12,
  windowMs: 60000,
  actionName: 'JOIN_DROP_QUEUE'
});

app.post('/api/queue/join', requireAuth, queueJoinLimiter, async (req: Request, res: Response) => {
  const { eventId } = req.body;
  const user = (req as any).user;
  const session = (req as any).session;

  if (!eventId) {
    res.status(400).json({ error: 'eventId is required' });
    return;
  }

  const event = queryOne<{ id: string; status: string; is_high_demand: number }>('SELECT id, status, is_high_demand FROM events WHERE id = ?', [eventId]);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  try {
    const queueStatus = await joinDropQueue(eventId, user.id, session.id);
    res.json(queueStatus);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to join drop queue' });
  }
});

// Fast-track demo admission endpoint
app.post('/api/queue/admit-me', requireAuth, async (req: Request, res: Response) => {
  const { eventId } = req.body;
  const user = (req as any).user;
  if (!eventId) {
    res.status(400).json({ error: 'eventId is required' });
    return;
  }

  const now = new Date();
  const admittedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 300 * 1000).toISOString();

  run(`
    UPDATE queue_entries
    SET status = 'ADMITTED', admitted_at = ?, expires_at = ?
    WHERE event_id = ? AND user_id = ?
  `, [admittedAt, expiresAt, eventId, user.id]);

  const queueStatus = getQueueStatus(eventId, user.id);
  res.json(queueStatus || { status: 'ADMITTED' });
});

app.get('/api/queue/status', requireAuth, (req: Request, res: Response) => {
  const { eventId } = req.query;
  const user = (req as any).user;

  if (!eventId || typeof eventId !== 'string') {
    res.status(400).json({ error: 'eventId is required' });
    return;
  }

  const status = getQueueStatus(eventId, user.id);
  if (!status) {
    res.status(404).json({ error: 'Not in waiting room for this event' });
    return;
  }

  res.json(status);
});

// SSE endpoint for waiting room real-time updates
app.get('/api/queue/stream', (req: Request, res: Response) => {
  const { eventId } = req.query;
  if (!eventId || typeof eventId !== 'string') {
    res.status(400).end('eventId required');
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);

  const unsubscribe = subscribeToQueue(eventId, (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

// ==========================================
// 4. INVENTORY, HOLDS & BOOKINGS (CUSTOMER)
// ==========================================

const holdLimiter = createRateLimiter({
  keyPrefix: 'rl_hold',
  limit: 10,
  windowMs: 60000,
  actionName: 'CREATE_HOLD'
});

app.post('/api/inventory/hold', requireAuth, holdLimiter, async (req: Request, res: Response) => {
  const { eventId, ticketTypeId, quantity } = req.body;
  const user = (req as any).user;
  const session = (req as any).session;
  const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;

  if (!eventId || !ticketTypeId || !quantity) {
    res.status(400).json({ error: 'eventId, ticketTypeId, and quantity are required' });
    return;
  }

  // If high demand event, verify that the user was actually ADMITTED
  const event = queryOne<{ is_high_demand: number }>('SELECT is_high_demand FROM events WHERE id = ?', [eventId]);
  if (event?.is_high_demand) {
    const queueStatus = getQueueStatus(eventId, user.id);
    if (!queueStatus || queueStatus.status !== 'ADMITTED') {
      res.status(403).json({
        error: 'Admission required. You must wait in the Fair Drop waiting room until your turn is called.',
        code: 'NOT_ADMITTED'
      });
      return;
    }
  }

  try {
    const hold = await createTicketHold({
      eventId,
      ticketTypeId,
      userId: user.id,
      sessionId: session.id,
      quantity: parseInt(quantity, 10),
      holdDurationSec: 300,
      idempotencyKey
    });

    res.json(hold);
  } catch (err: any) {
    res.status(409).json({ error: err.message || 'Unable to hold tickets' });
  }
});

app.post('/api/bookings/confirm', requireAuth, async (req: Request, res: Response) => {
  const { holdId, attendeeName, paymentMethod } = req.body;
  const user = (req as any).user;
  const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;

  if (!holdId) {
    res.status(400).json({ error: 'holdId is required' });
    return;
  }

  try {
    const booking = await confirmBookingFromHold({
      holdId,
      userId: user.id,
      attendeeName: attendeeName || user.name,
      paymentMethod: paymentMethod || 'DEMO_PAY',
      idempotencyKey
    });

    res.json(booking);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Checkout failed' });
  }
});

// Direct booking for normal events
app.post('/api/bookings/direct', requireAuth, async (req: Request, res: Response) => {
  const { eventId, ticketTypeId, quantity, attendeeName } = req.body;
  const user = (req as any).user;
  const session = (req as any).session;
  const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;

  if (!eventId || !ticketTypeId || !quantity) {
    res.status(400).json({ error: 'eventId, ticketTypeId, and quantity are required' });
    return;
  }

  try {
    const hold = await createTicketHold({
      eventId,
      ticketTypeId,
      userId: user.id,
      sessionId: session.id,
      quantity: parseInt(quantity, 10),
      holdDurationSec: 120
    });

    const booking = await confirmBookingFromHold({
      holdId: hold.holdId,
      userId: user.id,
      attendeeName: attendeeName || user.name,
      paymentMethod: 'DEMO_PAY',
      idempotencyKey
    });

    res.json(booking);
  } catch (err: any) {
    res.status(409).json({ error: err.message || 'Booking failed' });
  }
});

app.get('/api/bookings/my', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user;
  const bookings = query<any>(`
    SELECT b.*, e.name as event_name, e.date as event_date, e.time as event_time, e.venue as event_venue, e.city as event_city, e.poster_url as event_poster, tt.name as ticket_name
    FROM bookings b
    JOIN events e ON b.event_id = e.id
    JOIN ticket_types tt ON b.ticket_type_id = tt.id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC
  `, [user.id]);

  res.json({ bookings });
});

app.get('/api/bookings/:id', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user;
  const bookingId = req.params.id;

  const booking = queryOne<any>(`
    SELECT b.*, e.name as event_name, e.date as event_date, e.time as event_time, e.venue as event_venue, e.city as event_city, e.poster_url as event_poster, tt.name as ticket_name
    FROM bookings b
    JOIN events e ON b.event_id = e.id
    JOIN ticket_types tt ON b.ticket_type_id = tt.id
    WHERE (b.id = ? OR b.booking_ref = ?) AND (b.user_id = ? OR ? = 'ADMIN')
  `, [bookingId, bookingId, user.id, user.role]);

  if (!booking) {
    res.status(404).json({ error: 'Booking not found' });
    return;
  }

  const items = query<any>(`
    SELECT bi.*, ti.seat_number
    FROM booking_items bi
    JOIN ticket_inventory ti ON bi.ticket_inventory_id = ti.id
    WHERE bi.booking_id = ?
  `, [booking.id]);

  res.json({ booking, items });
});

// ==========================================
// 5. ADMIN / SENTINEL PORTAL ENDPOINTS
// ==========================================

app.get('/api/admin/overview', requireAdmin, (req: Request, res: Response) => {
  // Aggregate real operational numbers from database
  const activeEvent = queryOne<any>('SELECT * FROM events WHERE is_high_demand = 1 LIMIT 1');
  const eventId = activeEvent?.id || 'evt_techfest_2026';

  const queueCounts = queryOne<any>(`
    SELECT
      COUNT(*) as total_queue,
      SUM(CASE WHEN status = 'WAITING' THEN 1 ELSE 0 END) as waiting_users,
      SUM(CASE WHEN status = 'ADMITTED' THEN 1 ELSE 0 END) as admitted_users
    FROM queue_entries WHERE event_id = ?
  `, [eventId]);

  const inventoryCounts = queryOne<any>(`
    SELECT
      COUNT(*) as total_capacity,
      SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status = 'HELD' THEN 1 ELSE 0 END) as held,
      SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed
    FROM ticket_inventory WHERE event_id = ?
  `, [eventId]);

  const activeHolds = queryOne<any>(`
    SELECT COUNT(*) as active_holds FROM ticket_holds WHERE event_id = ? AND status = 'ACTIVE'
  `, [eventId]);

  const securityCounts = queryOne<any>(`
    SELECT
      COUNT(*) as total_events,
      SUM(CASE WHEN severity IN ('HIGH', 'CRITICAL') THEN 1 ELSE 0 END) as high_severity
    FROM security_events
  `);

  const p95s = liveSecurityStats.p95Latencies;
  const avgLat = p95s.length > 0 ? p95s.reduce((a, b) => a + b, 0) / p95s.length : 18;
  const sorted = [...p95s].sort((a, b) => a - b);
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 28;

  res.json({
    activeEvent: activeEvent ? { id: activeEvent.id, name: activeEvent.name, status: activeEvent.status } : null,
    queue: {
      total: queueCounts?.total_queue || 0,
      waiting: queueCounts?.waiting_users || 0,
      admitted: queueCounts?.admitted_users || 0
    },
    inventory: {
      total: inventoryCounts?.total_capacity || 0,
      available: inventoryCounts?.available || 0,
      held: inventoryCounts?.held || 0,
      confirmed: inventoryCounts?.confirmed || 0,
      activeHoldsCount: activeHolds?.active_holds || 0
    },
    performance: {
      currentRps: liveSecurityStats.currentRps,
      totalRequests: liveSecurityStats.totalRequests,
      avgLatencyMs: Math.round(avgLat),
      p95LatencyMs: Math.round(p95),
      blockedRequests: liveSecurityStats.blockedRequests,
      mitigatedRequests: liveSecurityStats.mitigatedRequests,
      suspiciousRequests: liveSecurityStats.suspiciousRequests,
      restrictedSessionsCount: liveSecurityStats.activeRestrictedSessions
    },
    systemStatus: 'HEALTHY'
  });
});

app.get('/api/admin/events', requireAdmin, (req: Request, res: Response) => {
  const events = query<any>('SELECT * FROM events ORDER BY created_at DESC');
  res.json({ events });
});

app.post('/api/admin/events/:id/status', requireAdmin, (req: Request, res: Response) => {
  const { status } = req.body;
  const eventId = req.params.id;

  if (!['DRAFT', 'OPEN', 'LIVE_DROP', 'CLOSED'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  run('UPDATE events SET status = ? WHERE id = ?', [status, eventId]);
  res.json({ message: 'Event status updated', status });
});

app.post('/api/admin/drop/admit-batch', requireAdmin, async (req: Request, res: Response) => {
  const { eventId, batchSize } = req.body;
  if (!eventId) {
    res.status(400).json({ error: 'eventId required' });
    return;
  }

  const result = await processAdmissionBatch(eventId, batchSize ? parseInt(batchSize, 10) : 25);
  res.json(result);
});

app.get('/api/admin/inventory/:eventId', requireAdmin, (req: Request, res: Response) => {
  const eventId = req.params.eventId;
  const seats = query<any>('SELECT * FROM ticket_inventory WHERE event_id = ? ORDER BY seat_number ASC LIMIT 200', [eventId]);
  const activeHolds = query<any>('SELECT * FROM ticket_holds WHERE event_id = ? AND status = "ACTIVE" ORDER BY expires_at ASC', [eventId]);
  const summary = queryOne<any>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status = 'HELD' THEN 1 ELSE 0 END) as held,
      SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed
    FROM ticket_inventory WHERE event_id = ?
  `, [eventId]);

  res.json({
    summary,
    activeHolds,
    seats
  });
});

app.post('/api/admin/inventory/release-hold', requireAdmin, async (req: Request, res: Response) => {
  const { holdId } = req.body;
  if (!holdId) {
    res.status(400).json({ error: 'holdId required' });
    return;
  }

  const hold = queryOne<any>('SELECT * FROM ticket_holds WHERE id = ?', [holdId]);
  if (!hold) {
    res.status(404).json({ error: 'Hold not found' });
    return;
  }

  await withTransaction(() => {
    run('UPDATE ticket_holds SET status = "RELEASED" WHERE id = ?', [holdId]);
    run('UPDATE ticket_inventory SET status = "AVAILABLE", hold_id = NULL WHERE hold_id = ?', [holdId]);
  });

  res.json({ message: 'Hold successfully released back to available inventory' });
});

app.get('/api/admin/bookings', requireAdmin, (req: Request, res: Response) => {
  const bookings = query<any>(`
    SELECT b.*, u.email as user_email, u.name as user_name, e.name as event_name, tt.name as ticket_tier
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    JOIN events e ON b.event_id = e.id
    JOIN ticket_types tt ON b.ticket_type_id = tt.id
    ORDER BY b.created_at DESC
    LIMIT 100
  `);
  res.json({ bookings });
});

app.get('/api/admin/security/events', requireAdmin, (req: Request, res: Response) => {
  const events = query<any>('SELECT * FROM security_events ORDER BY created_at DESC LIMIT 50');
  res.json({ events });
});

app.post('/api/admin/security/restrict', requireAdmin, (req: Request, res: Response) => {
  const { sessionId, reason } = req.body;
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId required' });
    return;
  }
  restrictSession(sessionId, reason || 'Manually restricted by admin');
  res.json({ message: 'Session restricted' });
});

app.post('/api/admin/security/unrestrict', requireAdmin, (req: Request, res: Response) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId required' });
    return;
  }
  unrestrictSession(sessionId);
  res.json({ message: 'Session unrestricted' });
});

app.get('/api/admin/rules', requireAdmin, (req: Request, res: Response) => {
  const rules = query<any>('SELECT * FROM admin_rules ORDER BY rule_key ASC');
  res.json({ rules });
});

app.put('/api/admin/rules/:key', requireAdmin, (req: Request, res: Response) => {
  const key = req.params.key;
  const { value, isActive } = req.body;
  const user = (req as any).user;

  run(`
    UPDATE admin_rules
    SET rule_value = ?, is_active = ?, updated_by = ?, updated_at = ?
    WHERE rule_key = ?
  `, [value, isActive ? 1 : 0, user.email, new Date().toISOString(), key]);

  res.json({ message: 'Rule updated' });
});

app.get('/api/admin/system/health', requireAdmin, (req: Request, res: Response) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ONLINE',
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      type: 'SQLite WebAssembly (ACID Transacted)',
      healthy: true
    },
    workers: {
      holdExpiryWorker: 'ACTIVE (1500ms)',
      admissionScheduler: 'ACTIVE (4000ms)'
    },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024)
    }
  });
});

app.post('/api/admin/system/run-tests', requireAdmin, async (req: Request, res: Response) => {
  try {
    const summary = await runAllTests();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Verification tests failed' });
  }
});

// ==========================================
// 6. ADVERSARIAL SIMULATION & FAIRNESS LAB (ADMIN)
// ==========================================

app.post('/api/admin/simulation/start', requireAdmin, async (req: Request, res: Response) => {
  const {
    scenario = 'REQUEST_FLOOD',
    mode = 'FAIR_DROP',
    targetEventId = 'evt_techfest_2026',
    targetCapacity = 50,
    totalClients = 100,
    legitimateClients = 80,
    automatedClients = 20,
    durationSec = 20,
    trafficIntensity = 'HIGH'
  } = req.body;

  try {
    const progress = await startSimulation({
      scenario,
      mode,
      targetEventId,
      targetCapacity,
      totalClients,
      legitimateClients,
      automatedClients,
      durationSec,
      trafficIntensity
    });
    res.json(progress);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to start simulation' });
  }
});

app.post('/api/admin/simulation/stop', requireAdmin, async (req: Request, res: Response) => {
  const stopped = await stopSimulation();
  res.json(stopped || { status: 'STOPPED' });
});

app.get('/api/admin/simulation/progress', requireAdmin, (req: Request, res: Response) => {
  const progress = getCurrentSimulationProgress();
  res.json(progress || { status: 'IDLE' });
});

app.get('/api/admin/simulation/report', requireAdmin, (req: Request, res: Response) => {
  const runId = req.query.runId as string | undefined;
  const report = getFairnessReportData(runId);
  if (!report) {
    res.status(404).json({ error: 'No fairness experiment report found. Please run an experiment first.' });
    return;
  }
  res.json(report);
});

// ==========================================
// 7. VITE CLIENT MOUNT (FULL STACK)
// ==========================================

const isProduction = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));

if (!isProduction) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(process.cwd(), 'dist')));
  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`[FairDrop Engine] Server running on http://0.0.0.0:${port}`);
});
