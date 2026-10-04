import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, run, withTransaction } from './db.js';
import { logSecurityEvent } from './security.js';

export interface QueueStatusResult {
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

// In-memory SSE subscriber registry for real-time queue notifications
type QueueSubscriber = (data: any) => void;
const queueSubscribers = new Map<string, Set<QueueSubscriber>>();

export function subscribeToQueue(eventId: string, callback: QueueSubscriber): () => void {
  if (!queueSubscribers.has(eventId)) {
    queueSubscribers.set(eventId, new Set());
  }
  queueSubscribers.get(eventId)!.add(callback);
  return () => {
    queueSubscribers.get(eventId)?.delete(callback);
  };
}

export function broadcastQueueUpdate(eventId: string, payload: any): void {
  const subs = queueSubscribers.get(eventId);
  if (subs) {
    subs.forEach(cb => {
      try { cb(payload); } catch (e) { /* ignore closed streams */ }
    });
  }
}

// Generates or retrieves the single authoritative FairDrop identity per (user, event)
export async function getOrCreateFairDropToken(
  eventId: string,
  userId: string,
  sessionId: string
): Promise<{ tokenHash: string; fairDropId: string; isNew: boolean }> {
  // Check if a token already exists for this user and event
  const existing = queryOne<{
    id: string;
    token_hash: string;
    status: string;
  }>('SELECT id, token_hash, status FROM fair_drop_tokens WHERE event_id = ? AND user_id = ?', [eventId, userId]);

  if (existing) {
    return {
      tokenHash: existing.token_hash,
      fairDropId: existing.id,
      isNew: false
    };
  }

  // Generate canonical Fair Drop Identity: e.g., FD-7X92-A81K
  const rawHash = crypto.createHash('sha256').update(`${eventId}:${userId}:fairdrop_identity_salt`).digest('hex');
  const fairDropId = `FD-${rawHash.substring(0, 4).toUpperCase()}-${rawHash.substring(4, 8).toUpperCase()}`;
  const tokenHash = `fdt_${crypto.randomBytes(24).toString('hex')}`;
  const now = new Date().toISOString();

  // First valid arrival timestamp weighting:
  // We assign a discrete 5-second arrival window bucket so milliseconds latency jitter does not advantage bots
  const joinTimestamp = Date.now();
  const bucketWindow = Math.floor(joinTimestamp / 5000);
  const priority = bucketWindow;

  run(`
    INSERT INTO fair_drop_tokens (id, token_hash, event_id, user_id, session_id, first_joined_at, join_weight, admission_priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1.0, ?, 'ACTIVE', ?)
  `, [fairDropId, tokenHash, eventId, userId, sessionId, now, priority, now]);

  return {
    tokenHash,
    fairDropId,
    isNew: true
  };
}

// Join the high-demand drop queue
export async function joinDropQueue(
  eventId: string,
  userId: string,
  sessionId: string
): Promise<QueueStatusResult> {
  return await withTransaction(async () => {
    // 1. Get or create FairDrop allocation token (strict deduplication)
    const { tokenHash, fairDropId, isNew } = await getOrCreateFairDropToken(eventId, userId, sessionId);

    // 2. Check if user already has an active queue entry
    const existingQueue = queryOne<{
      id: string;
      position: number;
      original_position: number;
      status: 'WAITING' | 'ADMITTED' | 'EXPIRED' | 'CANCELLED';
      admitted_at: string | null;
      expires_at: string | null;
      reconnect_count: number;
    }>('SELECT * FROM queue_entries WHERE event_id = ? AND user_id = ?', [eventId, userId]);

    const now = new Date();
    const nowIso = now.toISOString();

    if (existingQueue) {
      // Re-joining or reconnecting: preserve exact queue state!
      const reconnectCount = existingQueue.reconnect_count + 1;
      run(`
        UPDATE queue_entries
        SET session_id = ?, reconnect_count = ?, last_heartbeat_at = ?
        WHERE id = ?
      `, [sessionId, reconnectCount, nowIso, existingQueue.id]);

      // Calculate current participants ahead
      const aheadRes = queryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM queue_entries
        WHERE event_id = ? AND status = 'WAITING' AND position < ?
      `, [eventId, existingQueue.position]);

      const totalWaitingRes = queryOne<{ count: number }>(`
        SELECT COUNT(*) as count FROM queue_entries
        WHERE event_id = ? AND status = 'WAITING'
      `, [eventId]);

      return {
        token: tokenHash,
        fairDropId,
        position: existingQueue.position,
        participantsAhead: aheadRes?.count || 0,
        totalWaiting: totalWaitingRes?.count || 1,
        status: existingQueue.status,
        admittedAt: existingQueue.admitted_at || undefined,
        expiresAt: existingQueue.expires_at || undefined,
        connectionStatus: 'SESSION_RESTORED',
        reconnectCount
      };
    }

    // 3. New queue entry: calculate next position
    const maxPosRes = queryOne<{ max_pos: number | null }>(`
      SELECT MAX(position) as max_pos FROM queue_entries WHERE event_id = ?
    `, [eventId]);
    const nextPosition = (maxPosRes?.max_pos || 0) + 1;

    const queueId = `qe_${uuidv4().replace(/-/g, '')}`;
    run(`
      INSERT INTO queue_entries (id, event_id, user_id, session_id, fair_drop_token_id, position, original_position, status, reconnect_count, last_heartbeat_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING', 0, ?, ?)
    `, [queueId, eventId, userId, sessionId, fairDropId, nextPosition, nextPosition, nowIso, nowIso]);

    // Calculate ahead
    const aheadRes = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM queue_entries
      WHERE event_id = ? AND status = 'WAITING' AND position < ?
    `, [eventId, nextPosition]);

    const totalWaitingRes = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM queue_entries
      WHERE event_id = ? AND status = 'WAITING'
    `, [eventId]);

    broadcastQueueUpdate(eventId, {
      type: 'QUEUE_JOINED',
      eventId,
      totalWaiting: totalWaitingRes?.count || 1
    });

    return {
      token: tokenHash,
      fairDropId,
      position: nextPosition,
      participantsAhead: aheadRes?.count || 0,
      totalWaiting: totalWaitingRes?.count || 1,
      status: 'WAITING',
      connectionStatus: 'CONNECTED',
      reconnectCount: 0
    };
  });
}

// Get live queue status for an authenticated session / token
export function getQueueStatus(eventId: string, userId: string): QueueStatusResult | null {
  const tokenRecord = queryOne<{
    id: string;
    token_hash: string;
  }>('SELECT id, token_hash FROM fair_drop_tokens WHERE event_id = ? AND user_id = ?', [eventId, userId]);

  if (!tokenRecord) return null;

  const queueEntry = queryOne<{
    id: string;
    position: number;
    original_position: number;
    status: 'WAITING' | 'ADMITTED' | 'EXPIRED' | 'CANCELLED';
    admitted_at: string | null;
    expires_at: string | null;
    reconnect_count: number;
    last_heartbeat_at: string;
  }>('SELECT * FROM queue_entries WHERE event_id = ? AND user_id = ?', [eventId, userId]);

  if (!queueEntry) return null;

  // Check if admission has expired
  if (queueEntry.status === 'ADMITTED' && queueEntry.expires_at) {
    if (new Date().toISOString() > queueEntry.expires_at) {
      run('UPDATE queue_entries SET status = "EXPIRED" WHERE id = ?', [queueEntry.id]);
      queueEntry.status = 'EXPIRED';
    }
  }

  const aheadRes = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM queue_entries
    WHERE event_id = ? AND status = 'WAITING' AND position < ?
  `, [eventId, queueEntry.position]);

  const totalWaitingRes = queryOne<{ count: number }>(`
    SELECT COUNT(*) as count FROM queue_entries
    WHERE event_id = ? AND status = 'WAITING'
  `, [eventId]);

  return {
    token: tokenRecord.token_hash,
    fairDropId: tokenRecord.id,
    position: queueEntry.position,
    participantsAhead: aheadRes?.count || 0,
    totalWaiting: totalWaitingRes?.count || 0,
    status: queueEntry.status,
    admittedAt: queueEntry.admitted_at || undefined,
    expiresAt: queueEntry.expires_at || undefined,
    connectionStatus: 'CONNECTED',
    reconnectCount: queueEntry.reconnect_count
  };
}

// Process admission batch (called periodically or triggered by admin)
export async function processAdmissionBatch(eventId: string, batchSize: number = 25): Promise<{
  admittedCount: number;
  remainingWaiting: number;
}> {
  return await withTransaction(async () => {
    const config = queryOne<{
      batch_size: number;
      hold_timeout_sec: number;
      is_active: number;
    }>('SELECT * FROM drop_admission_configs WHERE event_id = ?', [eventId]);

    const actualBatchSize = batchSize || (config ? config.batch_size : 25);
    const holdDurationSec = config ? config.hold_timeout_sec : 300;

    // Get next WAITING users ordered by position
    const waitingUsers = query<{
      id: string;
      user_id: string;
      fair_drop_token_id: string;
      position: number;
    }>(`
      SELECT id, user_id, fair_drop_token_id, position
      FROM queue_entries
      WHERE event_id = ? AND status = 'WAITING'
      ORDER BY position ASC
      LIMIT ?
    `, [eventId, actualBatchSize]);

    if (waitingUsers.length === 0) {
      return { admittedCount: 0, remainingWaiting: 0 };
    }

    const now = new Date();
    const admittedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + holdDurationSec * 1000).toISOString();

    for (const user of waitingUsers) {
      run(`
        UPDATE queue_entries
        SET status = 'ADMITTED', admitted_at = ?, expires_at = ?
        WHERE id = ?
      `, [admittedAt, expiresAt, user.id]);
    }

    const remainingRes = queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM queue_entries
      WHERE event_id = ? AND status = 'WAITING'
    `, [eventId]);

    broadcastQueueUpdate(eventId, {
      type: 'BATCH_ADMITTED',
      admittedCount: waitingUsers.length,
      remainingWaiting: remainingRes?.count || 0,
      timestamp: admittedAt
    });

    return {
      admittedCount: waitingUsers.length,
      remainingWaiting: remainingRes?.count || 0
    };
  });
}
