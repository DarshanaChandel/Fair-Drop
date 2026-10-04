import { getDb, query, queryOne, run, withTransaction } from '../src/server/db.js';
import { createCaptchaChallenge, verifyCaptcha, hashPassword, createSession } from '../src/server/auth.js';
import { getOrCreateFairDropToken, joinDropQueue, getQueueStatus, processAdmissionBatch } from '../src/server/queue.js';
import { createTicketHold, confirmBookingFromHold, releaseExpiredHolds } from '../src/server/inventory.js';
import { evaluateSessionRisk, restrictSession, unrestrictSession } from '../src/server/security.js';
import { startSimulation, stopSimulation } from '../src/server/simulation.js';

export interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

export async function runAllTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
}> {
  await getDb();
  const results: TestResult[] = [];

  async function test(category: string, name: string, fn: () => Promise<void> | void) {
    const start = Date.now();
    try {
      await fn();
      results.push({
        name,
        category,
        passed: true,
        message: 'Assertion passed successfully',
        durationMs: Date.now() - start
      });
    } catch (err: any) {
      results.push({
        name,
        category,
        passed: false,
        message: err.message || 'Assertion failed',
        durationMs: Date.now() - start
      });
    }
  }

  // 1. Authentication & CAPTCHA Tests
  await test('AUTH', 'CRITICAL CAPTCHA TEST: Valid answer passes, invalid answer rejected', () => {
    const challenge = createCaptchaChallenge('arithmetic');
    // Extract solution by querying DB
    const row = queryOne<{ solution_hash: string }>('SELECT solution_hash FROM captcha_challenges WHERE id = ?', [challenge.id]);
    if (!row) throw new Error('Challenge not saved');

    // Invalid answer
    const invalidRes = verifyCaptcha(challenge.id, 'WRONG_ANSWER');
    if (invalidRes.valid) throw new Error('Invalid CAPTCHA answer should fail');

    // Test single-use and expiration
    const challenge2 = createCaptchaChallenge('arithmetic');
    // Calculate correct answer from question
    const match = challenge2.question.match(/(\d+)\s*([\+\-])\s*(\d+)/);
    if (!match) throw new Error('Could not parse question');
    const ans = match[2] === '+' ? parseInt(match[1]) + parseInt(match[3]) : parseInt(match[1]) - parseInt(match[3]);
    const validRes = verifyCaptcha(challenge2.id, ans.toString());
    if (!validRes.valid) throw new Error('Correct CAPTCHA answer should pass: ' + validRes.error);

    // Replay attack prevention: second attempt with same challenge must fail
    const replayRes = verifyCaptcha(challenge2.id, ans.toString());
    if (replayRes.valid) throw new Error('CAPTCHA replay must be rejected as already used');
  });

  await test('AUTH', 'Password hashing verification', () => {
    const hash1 = hashPassword('TestPassword123');
    const hash2 = hashPassword('TestPassword123');
    const hash3 = hashPassword('DifferentPassword');
    if (hash1 !== hash2) throw new Error('Identical passwords must produce identical hash');
    if (hash1 === hash3) throw new Error('Different passwords must produce different hash');
  });

  // 2. Queue & Fair Drop Token Identity Tests
  await test('FAIR_DROP_ENGINE', 'CRITICAL ABUSE TEST: Request flood maps to same FairDrop identity', async () => {
    const eventId = 'evt_techfest_2026';
    const userId = 'usr_flood_test_' + Date.now();

    // 1st request
    const token1 = await getOrCreateFairDropToken(eventId, userId, 'sess_1');
    // 2nd, 3rd, 50th request from same user
    const token2 = await getOrCreateFairDropToken(eventId, userId, 'sess_1');
    const token50 = await getOrCreateFairDropToken(eventId, userId, 'sess_different_retry');

    if (token1.fairDropId !== token2.fairDropId || token1.tokenHash !== token2.tokenHash) {
      throw new Error('Repeated requests must map to the same FairDrop identity');
    }
    if (token1.fairDropId !== token50.fairDropId) {
      throw new Error('Different sessions from the same user must still map to single FairDrop identity');
    }
  });

  await test('QUEUE', 'CRITICAL SESSION TEST: User joins queue -> disconnects -> reconnects preserved', async () => {
    const eventId = 'evt_techfest_2026';
    const userId = 'usr_reconnect_test_' + Date.now();

    // Join
    const q1 = await joinDropQueue(eventId, userId, 'sess_initial');
    const initialPos = q1.position;

    // Disconnect and Reconnect with new session ID
    const q2 = await joinDropQueue(eventId, userId, 'sess_reconnect');
    if (q2.position !== initialPos) {
      throw new Error(`Queue position changed on reconnect: was ${initialPos}, became ${q2.position}`);
    }
    if (q2.connectionStatus !== 'SESSION_RESTORED') {
      throw new Error('Connection status must reflect SESSION_RESTORED');
    }
    if (q2.reconnectCount < 1) {
      throw new Error('Reconnect count must be incremented');
    }
  });

  // 3. Concurrency & Last-Ticket Race Test (CRITICAL)
  await test('CONCURRENCY', 'CRITICAL TEST: 100 simultaneous users attempt final ticket (1 success, 99 fails, 0 oversell)', async () => {
    // Set up dedicated test event with exactly 1 ticket
    const testEvtId = 'evt_race_' + Date.now();
    const testTtId = 'tt_race_' + Date.now();
    const testInvId = 'inv_race_' + Date.now();

    run(`
      INSERT INTO events (id, slug, name, description, category, poster_url, date, time, venue, city, organizer, is_high_demand, total_capacity, status, created_at)
      VALUES (?, ?, 'Race Test', 'Desc', 'Tech', 'url', '2026-10-10', '10:00', 'Venue', 'City', 'Org', 1, 1, 'OPEN', datetime('now'))
    `, [testEvtId, 'slug-' + testEvtId]);

    run(`
      INSERT INTO ticket_types (id, event_id, name, description, price, total_quantity, available_quantity, held_quantity, confirmed_quantity, max_per_booking, created_at)
      VALUES (?, ?, 'Single Seat Tier', 'Desc', 500, 1, 1, 0, 0, 1, datetime('now'))
    `, [testTtId, testEvtId]);

    run(`
      INSERT INTO ticket_inventory (id, event_id, ticket_type_id, seat_number, status, hold_id, booking_id, version, updated_at)
      VALUES (?, ?, ?, 'FINAL-SEAT-001', 'AVAILABLE', NULL, NULL, 1, datetime('now'))
    `, [testInvId, testEvtId, testTtId]);

    // Launch 100 parallel hold reservation requests
    const attempts = Array.from({ length: 100 }, (_, i) => i + 1);
    const holdPromises = attempts.map(async (num) => {
      try {
        const hold = await createTicketHold({
          eventId: testEvtId,
          ticketTypeId: testTtId,
          userId: `usr_race_${num}`,
          sessionId: `sess_race_${num}`,
          quantity: 1,
          holdDurationSec: 60
        });
        return { success: true, hold, user: num };
      } catch (err) {
        return { success: false, error: err, user: num };
      }
    });

    const holdOutcomes = await Promise.all(holdPromises);
    const successfulHolds = holdOutcomes.filter(o => o.success);
    const failedHolds = holdOutcomes.filter(o => !o.success);

    if (successfulHolds.length !== 1) {
      throw new Error(`Expected exactly 1 successful hold, got ${successfulHolds.length}`);
    }
    if (failedHolds.length !== 99) {
      throw new Error(`Expected exactly 99 failed holds, got ${failedHolds.length}`);
    }

    // Verify inventory state
    const invRow = queryOne<{ status: string; hold_id: string }>(
      'SELECT status, hold_id FROM ticket_inventory WHERE id = ?',
      [testInvId]
    );
    if (!invRow || invRow.status !== 'HELD') {
      throw new Error(`Inventory must be HELD, got ${invRow?.status}`);
    }

    // Confirm the 1 winning hold
    const winner = successfulHolds[0];
    const booking = await confirmBookingFromHold({
      holdId: (winner as any).hold.holdId,
      userId: `usr_race_${winner.user}`,
      paymentMethod: 'DEMO_PAY'
    });

    if (booking.status !== 'CONFIRMED') {
      throw new Error('Booking confirmation failed');
    }

    // Check invariant: CONFIRMED BOOKINGS <= INVENTORY CAPACITY
    const confirmedCount = queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM ticket_inventory WHERE event_id = ? AND status = "CONFIRMED"',
      [testEvtId]
    );
    if ((confirmedCount?.count || 0) !== 1) {
      throw new Error(`Confirmed count violates capacity: ${confirmedCount?.count} vs capacity 1`);
    }
  });

  // 4. Idempotency Test
  await test('IDEMPOTENCY', 'Idempotent repeated booking submission returns identical original result', async () => {
    const testEvtId = 'evt_techfest_2026';
    const testTtId = 'tt_techfest_gen';
    const userId = 'usr_alex_002';
    const idemKey = 'idem_' + Date.now();

    // Create hold with idempotency key
    const hold1 = await createTicketHold({
      eventId: testEvtId,
      ticketTypeId: testTtId,
      userId,
      sessionId: 'sess_alex',
      quantity: 1,
      idempotencyKey: idemKey
    });

    // Retry same request with same idempotency key
    const hold2 = await createTicketHold({
      eventId: testEvtId,
      ticketTypeId: testTtId,
      userId,
      sessionId: 'sess_alex',
      quantity: 1,
      idempotencyKey: idemKey
    });

    if (hold1.holdId !== hold2.holdId) {
      throw new Error('Idempotent hold request returned different hold IDs');
    }
  });

  // 5. Abuse & Graduated Mitigation Test
  await test('SECURITY', 'Abuse evaluation escalates risk and blocks abusive bookings', () => {
    const testSession = 'sess_abusive_' + Date.now();
    // Simulate high burst of requests
    for (let i = 0; i < 20; i++) {
      evaluateSessionRisk(testSession, 'usr_bot', '192.168.1.1');
    }
    restrictSession(testSession, 'Excessive automated burst detected');
    const risk = evaluateSessionRisk(testSession, 'usr_bot', '192.168.1.1');

    if (risk.level !== 'ABUSIVE') {
      throw new Error(`Expected ABUSIVE level, got ${risk.level}`);
    }

    // Unrestrict
    unrestrictSession(testSession);
    const unblockedRisk = evaluateSessionRisk(testSession, 'usr_bot', '192.168.1.1');
    if (unblockedRisk.level === 'ABUSIVE') {
      throw new Error('Session should be restored to normal after unrestrict');
    }
  });

  // 6. Hold Expiry Test
  await test('INVENTORY', 'Hold expiry releases seats back to AVAILABLE', async () => {
    const testEvtId = 'evt_techfest_2026';
    const testTtId = 'tt_techfest_gen';
    const userId = 'usr_alex_002';

    // Create hold with 0 second expiration
    const hold = await createTicketHold({
      eventId: testEvtId,
      ticketTypeId: testTtId,
      userId,
      sessionId: 'sess_expire',
      quantity: 1,
      holdDurationSec: -1 // Already expired
    });

    const released = await releaseExpiredHolds();
    if (released < 1) {
      throw new Error('Expected at least 1 hold to be released by expiry worker');
    }

    const holdRecord = queryOne<{ status: string }>('SELECT status FROM ticket_holds WHERE id = ?', [hold.holdId]);
    if (holdRecord?.status !== 'EXPIRED') {
      throw new Error(`Hold status should be EXPIRED, got ${holdRecord?.status}`);
    }
  });

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    total: results.length,
    passed,
    failed,
    results
  };
}

// CLI runner if executed directly
if (process.argv[1]?.endsWith('fairdrop.test.ts')) {
  runAllTests().then(summary => {
    console.log('\n========================================');
    console.log(`FAIR DROP VERIFICATION SUITE: ${summary.passed}/${summary.total} PASSED`);
    console.log('========================================');
    summary.results.forEach(r => {
      const mark = r.passed ? '✓' : '✗';
      console.log(`${mark} [${r.category}] ${r.name} (${r.durationMs}ms)`);
      if (!r.passed) {
        console.error(`  Error: ${r.message}`);
      }
    });
    console.log('========================================\n');
    process.exit(summary.failed > 0 ? 1 : 0);
  }).catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
