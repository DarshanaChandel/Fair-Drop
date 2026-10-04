import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

let dbInstance: Database | null = null;
const DB_FILE_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE_PATH = path.join(DB_FILE_DIR, 'fairdrop.db');

// Mutex for sequential transactional execution (critical for inventory concurrency protection)
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const run = () => {
        this.locked = true;
        resolve(() => {
          this.locked = false;
          const next = this.queue.shift();
          if (next) next();
        });
      };
      if (this.locked) {
        this.queue.push(run);
      } else {
        run();
      }
    });
  }
}

export const dbMutex = new AsyncMutex();

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_FILE_DIR)) {
    fs.mkdirSync(DB_FILE_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE_PATH);
      dbInstance = new SQL.Database(fileBuffer);
      initSchema(dbInstance);
      return dbInstance;
    } catch (err) {
      console.error('Failed to load existing SQLite database, creating new one', err);
    }
  }

  dbInstance = new SQL.Database();
  initSchema(dbInstance);
  seedInitialData(dbInstance);
  saveDbToDisk();
  return dbInstance;
}

export function saveDbToDisk(): void {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE_PATH, buffer);
  } catch (err) {
    console.error('Error saving SQLite database to disk:', err);
  }
}

export function query<T = any>(sqlStr: string, params: any[] = []): T[] {
  if (!dbInstance) throw new Error('Database not initialized');
  const stmt = dbInstance.prepare(sqlStr);
  if (params && params.length > 0) {
    stmt.bind(params);
  }
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export function queryOne<T = any>(sqlStr: string, params: any[] = []): T | null {
  const rows = query<T>(sqlStr, params);
  return rows.length > 0 ? rows[0] : null;
}

let transactionDepth = 0;

export function run(sqlStr: string, params: any[] = []): { changes: number } {
  if (!dbInstance) throw new Error('Database not initialized');
  dbInstance.run(sqlStr, params);
  if (transactionDepth === 0) {
    saveDbToDisk();
  }
  const res = query<{ changes: number }>('SELECT changes() as changes');
  return res[0] || { changes: 1 };
}

export async function withTransaction<T>(action: () => Promise<T> | T): Promise<T> {
  const isTopLevel = transactionDepth === 0;
  let release: (() => void) | null = null;
  if (isTopLevel) {
    release = await dbMutex.acquire();
  }
  const db = await getDb();
  transactionDepth++;
  const savepointName = `sp_${transactionDepth}`;

  if (isTopLevel) {
    db.run('BEGIN TRANSACTION;');
  } else {
    db.run(`SAVEPOINT ${savepointName};`);
  }

  try {
    const result = await action();
    if (isTopLevel) {
      db.run('COMMIT;');
      saveDbToDisk();
    } else {
      db.run(`RELEASE SAVEPOINT ${savepointName};`);
    }
    return result;
  } catch (error) {
    try {
      if (isTopLevel) {
        db.run('ROLLBACK;');
      } else {
        db.run(`ROLLBACK TO SAVEPOINT ${savepointName};`);
      }
    } catch (rbError) {
      // ignore rollback failure
    }
    throw error;
  } finally {
    transactionDepth--;
    if (isTopLevel && release) {
      release();
    }
  }
}

function initSchema(db: Database): void {
  db.run(`
    -- 1. Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 2. Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    -- 3. Captcha Challenges
    CREATE TABLE IF NOT EXISTS captcha_challenges (
      id TEXT PRIMARY KEY,
      challenge_type TEXT NOT NULL,
      question TEXT NOT NULL,
      solution_hash TEXT NOT NULL,
      svg_data TEXT NOT NULL,
      attempts_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    -- 4. Events
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      poster_url TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      venue TEXT NOT NULL,
      city TEXT NOT NULL,
      organizer TEXT NOT NULL,
      is_high_demand INTEGER NOT NULL DEFAULT 0,
      total_capacity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    -- 5. Ticket Types
    CREATE TABLE IF NOT EXISTS ticket_types (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price REAL NOT NULL,
      total_quantity INTEGER NOT NULL,
      available_quantity INTEGER NOT NULL,
      held_quantity INTEGER NOT NULL DEFAULT 0,
      confirmed_quantity INTEGER NOT NULL DEFAULT 0,
      max_per_booking INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id)
    );

    -- 6. Ticket Inventory
    CREATE TABLE IF NOT EXISTS ticket_inventory (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      ticket_type_id TEXT NOT NULL,
      seat_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      hold_id TEXT,
      booking_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id),
      FOREIGN KEY(ticket_type_id) REFERENCES ticket_types(id)
    );

    -- 7. Ticket Holds
    CREATE TABLE IF NOT EXISTS ticket_holds (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      ticket_type_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    -- 8. Bookings
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      booking_ref TEXT UNIQUE NOT NULL,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ticket_type_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'CONFIRMED',
      payment_method TEXT NOT NULL DEFAULT 'DEMO_PAY',
      qr_code_data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(event_id) REFERENCES events(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    -- 9. Booking Items
    CREATE TABLE IF NOT EXISTS booking_items (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      ticket_inventory_id TEXT NOT NULL,
      ticket_type_id TEXT NOT NULL,
      price REAL NOT NULL,
      attendee_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(booking_id) REFERENCES bookings(id)
    );

    -- 10. Queue Entries
    CREATE TABLE IF NOT EXISTS queue_entries (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      fair_drop_token_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      original_position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAITING',
      admitted_at TEXT,
      expires_at TEXT,
      reconnect_count INTEGER NOT NULL DEFAULT 0,
      last_heartbeat_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 11. Fair Drop Tokens
    CREATE TABLE IF NOT EXISTS fair_drop_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      first_joined_at TEXT NOT NULL,
      join_weight REAL NOT NULL DEFAULT 1.0,
      admission_priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL
    );

    -- 12. Behaviour Signals
    CREATE TABLE IF NOT EXISTS behaviour_signals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT,
      event_id TEXT,
      signal_type TEXT NOT NULL,
      score_delta REAL NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    -- 13. Risk Assessments
    CREATE TABLE IF NOT EXISTS risk_assessments (
      id TEXT PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      user_id TEXT,
      risk_level TEXT NOT NULL DEFAULT 'NORMAL',
      risk_score REAL NOT NULL DEFAULT 0.0,
      burst_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      parallel_count INTEGER NOT NULL DEFAULT 0,
      evaluated_at TEXT NOT NULL
    );

    -- 14. Security Events
    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'MEDIUM',
      session_id TEXT NOT NULL,
      user_id TEXT,
      ip_address TEXT NOT NULL,
      description TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      action_taken TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 15. Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'INFO',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- 16. Admin Rules
    CREATE TABLE IF NOT EXISTS admin_rules (
      id TEXT PRIMARY KEY,
      rule_key TEXT UNIQUE NOT NULL,
      rule_name TEXT NOT NULL,
      rule_value TEXT NOT NULL,
      description TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 17. Experiments
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      scenario TEXT NOT NULL,
      target_event_id TEXT NOT NULL,
      target_capacity INTEGER NOT NULL DEFAULT 500,
      total_clients INTEGER NOT NULL,
      legitimate_clients INTEGER NOT NULL,
      automated_clients INTEGER NOT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 20,
      traffic_intensity TEXT NOT NULL DEFAULT 'HIGH',
      status TEXT NOT NULL DEFAULT 'IDLE',
      created_at TEXT NOT NULL
    );

    -- 18. Simulation Clients
    CREATE TABLE IF NOT EXISTS simulation_clients (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_type TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      successful_bookings INTEGER NOT NULL DEFAULT 0,
      blocked_count INTEGER NOT NULL DEFAULT 0,
      last_status TEXT NOT NULL DEFAULT 'INITIALIZED',
      created_at TEXT NOT NULL
    );

    -- 19. Experiment Runs
    CREATE TABLE IF NOT EXISTS experiment_runs (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_actual_sec REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'RUNNING',
      created_at TEXT NOT NULL
    );

    -- 20. Experiment Metrics
    CREATE TABLE IF NOT EXISTS experiment_metrics (
      id TEXT PRIMARY KEY,
      experiment_run_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      active_clients INTEGER NOT NULL,
      current_rps REAL NOT NULL,
      legitimate_rps REAL NOT NULL,
      automated_rps REAL NOT NULL,
      latency_ms REAL NOT NULL,
      p95_latency_ms REAL NOT NULL,
      error_rate REAL NOT NULL,
      held_count INTEGER NOT NULL,
      confirmed_count INTEGER NOT NULL
    );

    -- 21. Fairness Results
    CREATE TABLE IF NOT EXISTS fairness_results (
      id TEXT PRIMARY KEY,
      experiment_run_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      total_requests INTEGER NOT NULL,
      peak_rps REAL NOT NULL,
      legitimate_requests INTEGER NOT NULL,
      automated_requests INTEGER NOT NULL,
      suspicious_requests INTEGER NOT NULL,
      mitigated_requests INTEGER NOT NULL,
      successful_allocations INTEGER NOT NULL,
      legitimate_allocations INTEGER NOT NULL,
      automated_allocations INTEGER NOT NULL,
      avg_latency_ms REAL NOT NULL,
      p95_latency_ms REAL NOT NULL,
      error_rate_pct REAL NOT NULL,
      duplicate_allocations INTEGER NOT NULL DEFAULT 0,
      oversell_count INTEGER NOT NULL DEFAULT 0,
      automation_advantage_pct REAL NOT NULL,
      requests_per_legitimate_win REAL NOT NULL,
      requests_per_automated_win REAL NOT NULL,
      inventory_integrity_valid INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    -- 22. Audit Logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 23. Idempotency Keys
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- 24. Drop Admission Configs
    CREATE TABLE IF NOT EXISTS drop_admission_configs (
      event_id TEXT PRIMARY KEY,
      batch_size INTEGER NOT NULL DEFAULT 25,
      interval_ms INTEGER NOT NULL DEFAULT 3000,
      max_admitted_concurrently INTEGER NOT NULL DEFAULT 100,
      hold_timeout_sec INTEGER NOT NULL DEFAULT 300,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_inventory_event_status ON ticket_inventory(event_id, status);
    CREATE INDEX IF NOT EXISTS idx_holds_status ON ticket_holds(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_queue_event_status ON queue_entries(event_id, status, position);
    CREATE INDEX IF NOT EXISTS idx_tokens_event_user ON fair_drop_tokens(event_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_event ON bookings(event_id);
  `);
}

function hashPassword(password: string): string {
  const salt = 'fairdrop_secure_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function seedInitialData(db: Database): void {
  const now = new Date().toISOString();

  // 1. Seed Users (Admin & Standard User)
  const adminId = 'usr_admin_001';
  const adminPass = hashPassword('Admin@FairDrop2026!');
  db.run(`
    INSERT OR REPLACE INTO users (id, email, password_hash, name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ADMIN', ?, ?)
  `, [adminId, 'admin@fairdrop.io', adminPass, 'Sentinel Admin', now, now]);

  const demoUserId = 'usr_alex_002';
  const demoPass = hashPassword('User@FairDrop2026!');
  db.run(`
    INSERT OR REPLACE INTO users (id, email, password_hash, name, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'USER', ?, ?)
  `, [demoUserId, 'alex@example.com', demoPass, 'Alex Mercer', now, now]);

  // 2. Seed 8 Realistic Events (Flagship: TECHFEST 2026)
  const events = [
    {
      id: 'evt_techfest_2026',
      slug: 'techfest-2026',
      name: 'TECHFEST 2026: Global Frontier Summit',
      description: 'The premier global engineering, AI, and distributed systems summit. 50,000+ engineers participating for 500 exclusive seats. Powered by Fair Drop to ensure honest, zero-bot allocation.',
      category: 'Technology',
      poster_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=80',
      date: '2026-11-14',
      time: '09:00 AM - 06:00 PM',
      venue: 'Main Innovation Arena, Hall A',
      city: 'Bengaluru, India',
      organizer: 'Frontier Tech Foundation',
      is_high_demand: 1,
      total_capacity: 500,
      status: 'LIVE_DROP',
      settings_json: JSON.stringify({
        expected_participants: 50000,
        admission_batch_size: 25,
        admission_interval_sec: 4,
        hold_time_seconds: 300,
        require_captcha: true,
      })
    },
    {
      id: 'evt_acoustic_night_2026',
      slug: 'acoustic-soul-nights',
      name: 'Acoustic Soul Nights: Anirudh & Friends',
      description: 'An intimate candlelit evening of acoustic indie folk and contemporary soul music in an acoustically tuned auditorium.',
      category: 'Music',
      poster_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&q=80',
      date: '2026-10-24',
      time: '07:30 PM - 10:30 PM',
      venue: 'Symphony Grand Hall',
      city: 'Mumbai, India',
      organizer: 'Soulwave Productions',
      is_high_demand: 0,
      total_capacity: 400,
      status: 'OPEN',
      settings_json: '{}'
    },
    {
      id: 'evt_allstars_cricket_2026',
      slug: 't20-champions-derby',
      name: 'T20 Champions Derby: Titans vs Royals',
      description: 'High-voltage night cricket clash featuring international icons under the floodlights with stadium sound and electric fan zones.',
      category: 'Sports',
      poster_url: 'https://images.unsplash.com/photo-1531415074868-036b107e775a?w=1200&q=80',
      date: '2026-11-05',
      time: '07:00 PM - 11:00 PM',
      venue: 'National Cricket Arena',
      city: 'Delhi, India',
      organizer: 'Premier Cricket League',
      is_high_demand: 0,
      total_capacity: 1200,
      status: 'OPEN',
      settings_json: '{}'
    },
    {
      id: 'evt_standup_showcase_2026',
      slug: 'laughter-unfiltered-live',
      name: 'Laughter Unfiltered: Standup Comedy Showcase',
      description: 'Featuring 4 top national headliners for two hours of sharp, observational humor, crowd work, and unforgettable laughs.',
      category: 'Comedy',
      poster_url: 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=1200&q=80',
      date: '2026-10-30',
      time: '08:00 PM - 10:00 PM',
      venue: 'The Canvas Comedy Club',
      city: 'Bengaluru, India',
      organizer: 'LaughLab India',
      is_high_demand: 0,
      total_capacity: 250,
      status: 'OPEN',
      settings_json: '{}'
    },
    {
      id: 'evt_design_craft_2026',
      slug: 'design-systems-masterclass',
      name: 'Design Systems & Craft Masterclass 2026',
      description: 'Hands-on intensive for senior product designers and engineers building scalable component architectures and micro-interactions.',
      category: 'Workshop',
      poster_url: 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=1200&q=80',
      date: '2026-11-20',
      time: '10:00 AM - 04:00 PM',
      venue: 'WeWork Design Center',
      city: 'Hyderabad, India',
      organizer: 'Craft Guild',
      is_high_demand: 0,
      total_capacity: 150,
      status: 'OPEN',
      settings_json: '{}'
    },
    {
      id: 'evt_college_fest_2026',
      slug: 'pulse-intercollegiate-fest',
      name: 'PULSE 2026: Intercollegiate Cultural & Tech Fest',
      description: 'Three days of collegiate battle of the bands, hackathons, robo-wars, fashion shows, and celebrity pro-nights.',
      category: 'College Festival',
      poster_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80',
      date: '2026-12-04',
      time: '10:00 AM - 10:00 PM',
      venue: 'IIT Campus Open Air Theatre',
      city: 'Chennai, India',
      organizer: 'PULSE Student Council',
      is_high_demand: 0,
      total_capacity: 2500,
      status: 'OPEN',
      settings_json: '{}'
    },
    {
      id: 'evt_fintech_summit_2026',
      slug: 'asia-fintech-forum',
      name: 'Asia FinTech & Open Capital Forum 2026',
      description: 'Join founders, central bankers, and fintech builders discussing real-time payment rails, cross-border settlements, and DeFi safeguards.',
      category: 'Conference',
      poster_url: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=1200&q=80',
      date: '2026-11-28',
      time: '09:00 AM - 05:30 PM',
      venue: 'Grand Hyatt Convention Hub',
      city: 'Mumbai, India',
      organizer: 'FinTech Leaders Forum',
      is_high_demand: 0,
      total_capacity: 600,
      status: 'OPEN',
      settings_json: '{}'
    },
    {
      id: 'evt_cyber_conclave_2026',
      slug: 'zero-trust-cyber-conclave',
      name: 'Zero-Trust Defense Conclave 2026',
      description: 'Advanced defensive cybersecurity protocols, automated threat intelligence, and adversary simulation workshops for security leads.',
      category: 'Technology',
      poster_url: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&q=80',
      date: '2026-12-10',
      time: '09:30 AM - 05:00 PM',
      venue: 'Cyber City Tech Auditorium',
      city: 'Gurugram, India',
      organizer: 'CyberSec Alliance',
      is_high_demand: 0,
      total_capacity: 350,
      status: 'OPEN',
      settings_json: '{}'
    }
  ];

  for (const evt of events) {
    db.run(`
      INSERT OR REPLACE INTO events (id, slug, name, description, category, poster_url, date, time, venue, city, organizer, is_high_demand, total_capacity, status, settings_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [evt.id, evt.slug, evt.name, evt.description, evt.category, evt.poster_url, evt.date, evt.time, evt.venue, evt.city, evt.organizer, evt.is_high_demand, evt.total_capacity, evt.status, evt.settings_json, now]);
  }

  // 3. Seed Ticket Types for TECHFEST (Flagship 500 tickets)
  // 350 General @ ₹499, 150 VIP @ ₹999
  const techfestGeneralId = 'tt_techfest_gen';
  const techfestVipId = 'tt_techfest_vip';
  db.run(`
    INSERT OR REPLACE INTO ticket_types (id, event_id, name, description, price, total_quantity, available_quantity, held_quantity, confirmed_quantity, max_per_booking, created_at)
    VALUES (?, 'evt_techfest_2026', 'General Admission', 'Full access to all keynote tracks, hacker lounge, and exhibition expo.', 499, 350, 350, 0, 0, 2, ?)
  `, [techfestGeneralId, now]);

  db.run(`
    INSERT OR REPLACE INTO ticket_types (id, event_id, name, description, price, total_quantity, available_quantity, held_quantity, confirmed_quantity, max_per_booking, created_at)
    VALUES (?, 'evt_techfest_2026', 'VIP Frontier Pass', 'Priority frontline seating, speaker dinner invite, exclusive badge & swag kit.', 999, 150, 150, 0, 0, 2, ?)
  `, [techfestVipId, now]);

  // Seed individual inventory rows for TECHFEST (500 exact seats)
  for (let i = 1; i <= 350; i++) {
    const seatId = `inv_tf_gen_${i.toString().padStart(3, '0')}`;
    const seatNum = `GEN-A${i.toString().padStart(3, '0')}`;
    db.run(`
      INSERT OR REPLACE INTO ticket_inventory (id, event_id, ticket_type_id, seat_number, status, hold_id, booking_id, version, updated_at)
      VALUES (?, 'evt_techfest_2026', ?, ?, 'AVAILABLE', NULL, NULL, 1, ?)
    `, [seatId, techfestGeneralId, seatNum, now]);
  }
  for (let i = 1; i <= 150; i++) {
    const seatId = `inv_tf_vip_${i.toString().padStart(3, '0')}`;
    const seatNum = `VIP-S${i.toString().padStart(3, '0')}`;
    db.run(`
      INSERT OR REPLACE INTO ticket_inventory (id, event_id, ticket_type_id, seat_number, status, hold_id, booking_id, version, updated_at)
      VALUES (?, 'evt_techfest_2026', ?, ?, 'AVAILABLE', NULL, NULL, 1, ?)
    `, [seatId, techfestVipId, seatNum, now]);
  }

  // Seed Ticket Types for other events
  const otherEventConfigs = [
    { evtId: 'evt_acoustic_night_2026', name: 'Standard Pass', price: 799, qty: 400 },
    { evtId: 'evt_allstars_cricket_2026', name: 'North Stand', price: 1200, qty: 1200 },
    { evtId: 'evt_standup_showcase_2026', name: 'Club Seat', price: 499, qty: 250 },
    { evtId: 'evt_design_craft_2026', name: 'Attendee Pass', price: 2499, qty: 150 },
    { evtId: 'evt_college_fest_2026', name: 'Student Pass', price: 299, qty: 2500 },
    { evtId: 'evt_fintech_summit_2026', name: 'Delegate Pass', price: 3499, qty: 600 },
    { evtId: 'evt_cyber_conclave_2026', name: 'Security Pass', price: 1999, qty: 350 },
  ];

  for (const cfg of otherEventConfigs) {
    const ttId = `tt_${cfg.evtId}`;
    db.run(`
      INSERT OR REPLACE INTO ticket_types (id, event_id, name, description, price, total_quantity, available_quantity, held_quantity, confirmed_quantity, max_per_booking, created_at)
      VALUES (?, ?, ?, 'Standard event entry ticket', ?, ?, ?, 0, 0, 4, ?)
    `, [ttId, cfg.evtId, cfg.name, cfg.price, cfg.qty, cfg.qty, now]);

    // Sample inventory rows for fast booking demonstration
    const sampleSeats = Math.min(cfg.qty, 50);
    for (let i = 1; i <= sampleSeats; i++) {
      const invId = `inv_${cfg.evtId}_${i}`;
      db.run(`
        INSERT OR REPLACE INTO ticket_inventory (id, event_id, ticket_type_id, seat_number, status, hold_id, booking_id, version, updated_at)
        VALUES (?, ?, ?, ?, 'AVAILABLE', NULL, NULL, 1, ?)
      `, [invId, cfg.evtId, ttId, `ST-${i}`, now]);
    }
  }

  // 4. Seed Drop Admission Config for TECHFEST
  db.run(`
    INSERT OR REPLACE INTO drop_admission_configs (event_id, batch_size, interval_ms, max_admitted_concurrently, hold_timeout_sec, is_active, updated_at)
    VALUES ('evt_techfest_2026', 25, 3000, 100, 300, 1, ?)
  `, [now]);

  // 5. Seed Admin Rules
  const defaultRules = [
    { key: 'RATE_LIMIT_LOGIN', name: 'Login Rate Limit', val: '5/min', desc: 'Max failed login attempts per minute per IP' },
    { key: 'RATE_LIMIT_DROP_JOIN', name: 'Drop Join Rate Limit', val: '10/min', desc: 'Max drop queue join requests per minute' },
    { key: 'RATE_LIMIT_HOLD', name: 'Ticket Hold Rate Limit', val: '6/min', desc: 'Max ticket reservation attempts per user' },
    { key: 'HOLD_EXPIRY_SECONDS', name: 'Hold Expiry Duration', val: '300', desc: 'Seconds before temporary ticket hold expires' },
    { key: 'MAX_CAPTCHA_ATTEMPTS', name: 'Max CAPTCHA Attempts', val: '3', desc: 'Allowed failed captcha attempts before token invalidation' },
    { key: 'ABUSE_BURST_THRESHOLD', name: 'Abuse Burst Threshold', val: '15/sec', desc: 'Requests per second triggering High Risk mitigation' },
    { key: 'GRADUATED_MITIGATION_ACTIVE', name: 'Graduated Mitigation', val: 'true', desc: 'Enable graduated mitigation without sudden bans' },
  ];

  for (const r of defaultRules) {
    const ruleId = `rule_${r.key.toLowerCase()}`;
    db.run(`
      INSERT OR REPLACE INTO admin_rules (id, rule_key, rule_name, rule_value, description, is_active, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 'SYSTEM', ?)
    `, [ruleId, r.key, r.name, r.val, r.desc, now]);
  }

  // 6. Seed a sample completed booking for Alex Mercer so "My Bookings" has immediate realistic history
  const sampleBookingId = 'bk_sample_alex_001';
  db.run(`
    INSERT OR REPLACE INTO bookings (id, booking_ref, event_id, user_id, ticket_type_id, quantity, total_amount, currency, status, payment_method, qr_code_data, created_at)
    VALUES (?, 'FD-BK-782194', 'evt_acoustic_night_2026', ?, 'tt_evt_acoustic_night_2026', 1, 799, 'INR', 'CONFIRMED', 'DEMO_PAY', 'FAIRDROP:TICKET:FD-BK-782194:alex@example.com:SEAT-ST-1', ?)
  `, [sampleBookingId, demoUserId, new Date(Date.now() - 86400000 * 2).toISOString()]);

  db.run(`
    INSERT OR REPLACE INTO booking_items (id, booking_id, ticket_inventory_id, ticket_type_id, price, attendee_name, created_at)
    VALUES ('bki_sample_001', ?, 'inv_evt_acoustic_night_2026_1', 'tt_evt_acoustic_night_2026', 799, 'Alex Mercer', ?)
  `, [sampleBookingId, new Date(Date.now() - 86400000 * 2).toISOString()]);

  // Mark seat as confirmed
  db.run(`
    UPDATE ticket_inventory SET status = 'CONFIRMED', booking_id = ? WHERE id = 'inv_evt_acoustic_night_2026_1'
  `, [sampleBookingId]);
}
