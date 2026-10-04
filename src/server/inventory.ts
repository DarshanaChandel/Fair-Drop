import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, run, withTransaction } from './db.js';

export interface HoldResult {
  holdId: string;
  ticketTypeId: string;
  quantity: number;
  expiresAt: string;
  totalPrice: number;
}

export interface BookingResult {
  bookingId: string;
  bookingRef: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  totalAmount: number;
  currency: string;
  status: string;
  qrCodeData: string;
  createdAt: string;
  seats: string[];
}

// Check and process idempotency key
export function checkIdempotency(key: string, userId: string, action: string) {
  if (!key) return null;
  const existing = queryOne<{
    response_status: number;
    response_body: string;
    expires_at: string;
  }>('SELECT response_status, response_body, expires_at FROM idempotency_keys WHERE key = ? AND user_id = ?', [key, userId]);

  if (existing) {
    if (new Date().toISOString() > existing.expires_at) {
      run('DELETE FROM idempotency_keys WHERE key = ?', [key]);
      return null;
    }
    return {
      status: existing.response_status,
      body: JSON.parse(existing.response_body)
    };
  }
  return null;
}

export function saveIdempotency(key: string, userId: string, action: string, status: number, body: any): void {
  if (!key) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  try {
    run(`
      INSERT OR REPLACE INTO idempotency_keys (key, user_id, action, request_hash, response_status, response_body, created_at, expires_at)
      VALUES (?, ?, ?, 'hash', ?, ?, ?, ?)
    `, [key, userId, action, status, JSON.stringify(body), now.toISOString(), expiresAt]);
  } catch (err) {
    // Ignore duplicate insert race
  }
}

// Atomic Hold Reservation with strict concurrency lock & inventory validation
export async function createTicketHold(params: {
  eventId: string;
  ticketTypeId: string;
  userId: string;
  sessionId: string;
  quantity: number;
  holdDurationSec?: number;
  idempotencyKey?: string;
}): Promise<HoldResult> {
  const { eventId, ticketTypeId, userId, sessionId, quantity, holdDurationSec = 300, idempotencyKey } = params;

  // 1. Idempotency Check
  if (idempotencyKey) {
    const cached = checkIdempotency(idempotencyKey, userId, 'CREATE_HOLD');
    if (cached) {
      return cached.body as HoldResult;
    }
  }

  // 2. Strict atomic transaction
  return await withTransaction(async () => {
    // Check ticket type details
    const ticketType = queryOne<{
      id: string;
      price: number;
      available_quantity: number;
      max_per_booking: number;
    }>('SELECT id, price, available_quantity, max_per_booking FROM ticket_types WHERE id = ? AND event_id = ?', [ticketTypeId, eventId]);

    if (!ticketType) {
      throw new Error('Ticket tier not found for this event');
    }

    if (quantity <= 0 || quantity > ticketType.max_per_booking) {
      throw new Error(`Quantity must be between 1 and ${ticketType.max_per_booking}`);
    }

    // Select exact available inventory seats with row lock semantics inside transaction
    const availableSeats = query<{ id: string; seat_number: string }>(`
      SELECT id, seat_number
      FROM ticket_inventory
      WHERE ticket_type_id = ? AND event_id = ? AND status = 'AVAILABLE'
      LIMIT ?
    `, [ticketTypeId, eventId, quantity]);

    if (availableSeats.length < quantity) {
      throw new Error('Requested tickets are no longer available (Sold Out)');
    }

    const holdId = `hold_${uuidv4().replace(/-/g, '')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + holdDurationSec * 1000).toISOString();

    // Create Hold Record
    run(`
      INSERT INTO ticket_holds (id, event_id, ticket_type_id, user_id, session_id, quantity, expires_at, status, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `, [holdId, eventId, ticketTypeId, userId, sessionId, quantity, expiresAt, idempotencyKey || null, now.toISOString()]);

    // Mark selected inventory seats as HELD
    for (const seat of availableSeats) {
      run(`
        UPDATE ticket_inventory
        SET status = 'HELD', hold_id = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'AVAILABLE'
      `, [holdId, now.toISOString(), seat.id]);
    }

    // Recalculate and update cached counts in ticket_types
    updateTicketTypeCounts(ticketTypeId);

    const result: HoldResult = {
      holdId,
      ticketTypeId,
      quantity,
      expiresAt,
      totalPrice: ticketType.price * quantity
    };

    if (idempotencyKey) {
      saveIdempotency(idempotencyKey, userId, 'CREATE_HOLD', 200, result);
    }

    return result;
  });
}

// Convert Hold to Confirmed Booking (Safe Demo Checkout)
export async function confirmBookingFromHold(params: {
  holdId: string;
  userId: string;
  paymentMethod?: string;
  attendeeName?: string;
  idempotencyKey?: string;
}): Promise<BookingResult> {
  const { holdId, userId, paymentMethod = 'DEMO_PAY', attendeeName = 'Guest Attendee', idempotencyKey } = params;

  if (idempotencyKey) {
    const cached = checkIdempotency(idempotencyKey, userId, 'CONFIRM_BOOKING');
    if (cached) {
      return cached.body as BookingResult;
    }
  }

  return await withTransaction(async () => {
    // 1. Validate Hold
    const hold = queryOne<{
      id: string;
      event_id: string;
      ticket_type_id: string;
      user_id: string;
      quantity: number;
      expires_at: string;
      status: string;
    }>('SELECT * FROM ticket_holds WHERE id = ?', [holdId]);

    if (!hold) {
      throw new Error('Hold reservation not found');
    }

    if (hold.user_id !== userId) {
      throw new Error('Unauthorized: Hold belongs to another account');
    }

    if (hold.status === 'CONVERTED') {
      // Find existing booking
      const existingBooking = queryOne<any>('SELECT * FROM bookings WHERE event_id = ? AND user_id = ? AND ticket_type_id = ? ORDER BY created_at DESC LIMIT 1', [hold.event_id, userId, hold.ticket_type_id]);
      if (existingBooking) {
        return {
          bookingId: existingBooking.id,
          bookingRef: existingBooking.booking_ref,
          eventId: existingBooking.event_id,
          ticketTypeId: existingBooking.ticket_type_id,
          quantity: existingBooking.quantity,
          totalAmount: existingBooking.total_amount,
          currency: existingBooking.currency,
          status: existingBooking.status,
          qrCodeData: existingBooking.qr_code_data,
          createdAt: existingBooking.created_at,
          seats: []
        };
      }
    }

    if (hold.status !== 'ACTIVE') {
      throw new Error(`Cannot checkout: Hold status is ${hold.status}`);
    }

    const now = new Date();
    if (now.toISOString() > hold.expires_at) {
      // Mark expired
      run('UPDATE ticket_holds SET status = "EXPIRED" WHERE id = ?', [holdId]);
      run('UPDATE ticket_inventory SET status = "AVAILABLE", hold_id = NULL WHERE hold_id = ?', [holdId]);
      updateTicketTypeCounts(hold.ticket_type_id);
      throw new Error('Ticket hold reservation has expired. Please select tickets again.');
    }

    // 2. Fetch held seats
    const heldSeats = query<{ id: string; seat_number: string }>(`
      SELECT id, seat_number FROM ticket_inventory WHERE hold_id = ? AND status = 'HELD'
    `, [holdId]);

    if (heldSeats.length < hold.quantity) {
      throw new Error('Mismatch in held inventory seats');
    }

    // 3. Fetch ticket type price
    const ticketType = queryOne<{ price: number }>('SELECT price FROM ticket_types WHERE id = ?', [hold.ticket_type_id]);
    const pricePerTicket = ticketType?.price || 0;
    const totalAmount = pricePerTicket * hold.quantity;

    // 4. Generate Booking
    const bookingId = `bk_${uuidv4().replace(/-/g, '')}`;
    const randSuffix = Math.floor(100000 + Math.random() * 900000);
    const bookingRef = `FD-BK-${randSuffix}`;
    const qrPayload = `FAIRDROP:TICKET:${bookingRef}:${userId}:${hold.event_id}:${heldSeats.map(s => s.seat_number).join(',')}`;

    run(`
      INSERT INTO bookings (id, booking_ref, event_id, user_id, ticket_type_id, quantity, total_amount, currency, status, payment_method, qr_code_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', 'CONFIRMED', ?, ?, ?)
    `, [bookingId, bookingRef, hold.event_id, userId, hold.ticket_type_id, hold.quantity, totalAmount, paymentMethod, qrPayload, now.toISOString()]);

    // Insert booking items & update seats to CONFIRMED
    for (const seat of heldSeats) {
      const itemId = `bki_${uuidv4().replace(/-/g, '')}`;
      run(`
        INSERT INTO booking_items (id, booking_id, ticket_inventory_id, ticket_type_id, price, attendee_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [itemId, bookingId, seat.id, hold.ticket_type_id, pricePerTicket, attendeeName, now.toISOString()]);

      run(`
        UPDATE ticket_inventory
        SET status = 'CONFIRMED', booking_id = ?, hold_id = NULL, updated_at = ?
        WHERE id = ?
      `, [bookingId, now.toISOString(), seat.id]);
    }

    // Update Hold status
    run(`UPDATE ticket_holds SET status = 'CONVERTED' WHERE id = ?`, [holdId]);

    // Update queue entry if applicable
    run(`
      UPDATE queue_entries SET status = 'CANCELLED' WHERE event_id = ? AND user_id = ?
    `, [hold.event_id, userId]);

    updateTicketTypeCounts(hold.ticket_type_id);

    const result: BookingResult = {
      bookingId,
      bookingRef,
      eventId: hold.event_id,
      ticketTypeId: hold.ticket_type_id,
      quantity: hold.quantity,
      totalAmount,
      currency: 'INR',
      status: 'CONFIRMED',
      qrCodeData: qrPayload,
      createdAt: now.toISOString(),
      seats: heldSeats.map(s => s.seat_number)
    };

    if (idempotencyKey) {
      saveIdempotency(idempotencyKey, userId, 'CONFIRM_BOOKING', 200, result);
    }

    return result;
  });
}

// Background Worker: Releases expired ticket holds and returns seats to AVAILABLE
export async function releaseExpiredHolds(): Promise<number> {
  const now = new Date().toISOString();
  const expiredHolds = query<{ id: string; ticket_type_id: string }>(`
    SELECT id, ticket_type_id FROM ticket_holds
    WHERE status = 'ACTIVE' AND expires_at < ?
  `, [now]);

  if (expiredHolds.length === 0) return 0;

  let releasedCount = 0;
  for (const hold of expiredHolds) {
    try {
      await withTransaction(() => {
        run('UPDATE ticket_holds SET status = "EXPIRED" WHERE id = ?', [hold.id]);
        run('UPDATE ticket_inventory SET status = "AVAILABLE", hold_id = NULL WHERE hold_id = ?', [hold.id]);
        updateTicketTypeCounts(hold.ticket_type_id);
        releasedCount++;
      });
    } catch (e) {
      console.error(`Failed to release expired hold ${hold.id}:`, e);
    }
  }

  return releasedCount;
}

// Start periodic worker for hold expiry
let holdWorkerInterval: NodeJS.Timeout | null = null;
export function startHoldWorker(intervalMs: number = 2000): void {
  if (holdWorkerInterval) return;
  holdWorkerInterval = setInterval(async () => {
    try {
      await releaseExpiredHolds();
    } catch (err) {
      // background worker error ignore
    }
  }, intervalMs);
}

// Helper to keep denormalized counts in sync
function updateTicketTypeCounts(ticketTypeId: string): void {
  const counts = queryOne<{
    available: number;
    held: number;
    confirmed: number;
  }>(`
    SELECT
      SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
      SUM(CASE WHEN status = 'HELD' THEN 1 ELSE 0 END) as held,
      SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed
    FROM ticket_inventory
    WHERE ticket_type_id = ?
  `, [ticketTypeId]);

  if (counts) {
    run(`
      UPDATE ticket_types
      SET available_quantity = ?, held_quantity = ?, confirmed_quantity = ?
      WHERE id = ?
    `, [counts.available || 0, counts.held || 0, counts.confirmed || 0, ticketTypeId]);
  }
}
