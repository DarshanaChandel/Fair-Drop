import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, run, withTransaction } from './db.js';

const PASSWORD_SALT = 'fairdrop_secure_salt_2026';

export function hashPassword(password: string): string {
  return crypto.pbkdf2Sync(password, PASSWORD_SALT, 10000, 64, 'sha512').toString('hex');
}

export function hashString(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

// Generates an SVG visual CAPTCHA with noise lines and skewed text
export function generateCaptchaSvg(text: string): string {
  const width = 220;
  const height = 70;
  const chars = text.split('');

  // Random noise lines
  let lines = '';
  for (let i = 0; i < 6; i++) {
    const x1 = Math.floor(Math.random() * width);
    const y1 = Math.floor(Math.random() * height);
    const x2 = Math.floor(Math.random() * width);
    const y2 = Math.floor(Math.random() * height);
    const stroke = ['#94a3b8', '#cbd5e1', '#64748b', '#475569'][i % 4];
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${1 + Math.random()}" stroke-opacity="0.6"/>`;
  }

  // Noise dots
  let dots = '';
  for (let i = 0; i < 40; i++) {
    const cx = Math.floor(Math.random() * width);
    const cy = Math.floor(Math.random() * height);
    dots += `<circle cx="${cx}" cy="${cy}" r="${Math.random() * 1.5}" fill="#94a3b8" fill-opacity="0.5"/>`;
  }

  // Text glyphs with slight rotation and displacement
  const charSpacing = width / (chars.length + 1.2);
  let glyphs = '';
  chars.forEach((char, idx) => {
    const x = Math.floor((idx + 0.8) * charSpacing);
    const y = Math.floor(height / 2 + 8 + (Math.random() * 8 - 4));
    const rot = Math.floor(Math.random() * 24 - 12);
    const fill = ['#0f172a', '#1e293b', '#334155', '#1e1b4b', '#047857'][idx % 5];
    glyphs += `<text x="${x}" y="${y}" font-family="monospace, sans-serif" font-weight="bold" font-size="28" fill="${fill}" transform="rotate(${rot}, ${x}, ${y})" letter-spacing="3">${char}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; user-select:none;">
    <rect width="100%" height="100%" fill="#f8fafc" rx="6"/>
    ${dots}
    ${lines}
    ${glyphs}
  </svg>`;
}

// Generate new server-authoritative CAPTCHA challenge
export function createCaptchaChallenge(type: 'text' | 'arithmetic' = 'arithmetic'): {
  id: string;
  challenge_type: string;
  question: string;
  svg_data: string;
  expires_at: string;
} {
  const id = `cap_${uuidv4().replace(/-/g, '')}`;
  let question = '';
  let solution = '';

  if (type === 'arithmetic') {
    const ops = ['+', '-'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let num1 = Math.floor(Math.random() * 40) + 10;
    let num2 = Math.floor(Math.random() * 20) + 1;
    if (op === '-' && num2 > num1) {
      [num1, num2] = [num2, num1];
    }
    const ans = op === '+' ? num1 + num2 : num1 - num2;
    question = `${num1} ${op} ${num2} = ?`;
    solution = ans.toString();
  } else {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    question = 'Enter the characters shown above';
    solution = code;
  }

  const solutionHash = hashString(solution);
  const svgData = generateCaptchaSvg(solution);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3 * 60 * 1000).toISOString(); // 3 minutes validity

  run(`
    INSERT INTO captcha_challenges (id, challenge_type, question, solution_hash, svg_data, attempts_count, max_attempts, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 3, ?, ?)
  `, [id, type, question, solutionHash, svgData, expiresAt, now.toISOString()]);

  return {
    id,
    challenge_type: type,
    question,
    svg_data: svgData,
    expires_at: expiresAt
  };
}

export function verifyCaptcha(challengeId: string, answer: string): { valid: boolean; error?: string } {
  if (!challengeId || !answer) {
    return { valid: false, error: 'CAPTCHA challenge ID and answer are required' };
  }

  const challenge = queryOne<{
    id: string;
    solution_hash: string;
    attempts_count: number;
    max_attempts: number;
    expires_at: string;
    used_at: string | null;
  }>('SELECT * FROM captcha_challenges WHERE id = ?', [challengeId]);

  if (!challenge) {
    return { valid: false, error: 'Invalid or non-existent CAPTCHA challenge' };
  }

  if (challenge.used_at) {
    return { valid: false, error: 'This CAPTCHA has already been used. Please refresh.' };
  }

  const now = new Date().toISOString();
  if (now > challenge.expires_at) {
    return { valid: false, error: 'CAPTCHA challenge has expired. Please refresh.' };
  }

  if (challenge.attempts_count >= challenge.max_attempts) {
    return { valid: false, error: 'Maximum CAPTCHA attempts exceeded. Please refresh.' };
  }

  // Increment attempt count
  run('UPDATE captcha_challenges SET attempts_count = attempts_count + 1 WHERE id = ?', [challengeId]);

  const providedHash = hashString(answer);
  if (providedHash !== challenge.solution_hash) {
    return { valid: false, error: 'Incorrect CAPTCHA answer. Please try again.' };
  }

  // Mark as redeemed/single-use
  run('UPDATE captcha_challenges SET used_at = ? WHERE id = ?', [now, challengeId]);
  return { valid: true };
}

export function createSession(userId: string, req: Request): { token: string; expires_at: string; session_id: string } {
  const token = `fd_sess_${crypto.randomBytes(32).toString('hex')}`;
  const sessionId = `sess_${uuidv4().replace(/-/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  const ip = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const ua = req.headers['user-agent'] || 'Unknown';

  run(`
    INSERT INTO sessions (id, user_id, token, ip_address, user_agent, status, expires_at, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
  `, [sessionId, userId, token, ip, ua, expiresAt, now.toISOString(), now.toISOString()]);

  return { token, expires_at: expiresAt, session_id: sessionId };
}

export function getSessionFromRequest(req: Request): {
  user: { id: string; email: string; name: string; role: string } | null;
  session: { id: string; token: string; user_id: string; expires_at: string } | null;
} {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers['x-session-token']) {
    token = req.headers['x-session-token'] as string;
  }

  if (!token) return { user: null, session: null };

  const session = queryOne<{
    id: string;
    token: string;
    user_id: string;
    status: string;
    expires_at: string;
  }>('SELECT * FROM sessions WHERE token = ? AND status = "ACTIVE"', [token]);

  if (!session) return { user: null, session: null };

  const now = new Date().toISOString();
  if (now > session.expires_at) {
    run('UPDATE sessions SET status = "EXPIRED" WHERE id = ?', [session.id]);
    return { user: null, session: null };
  }

  // Update last active
  run('UPDATE sessions SET last_active_at = ? WHERE id = ?', [now, session.id]);

  const user = queryOne<{
    id: string;
    email: string;
    name: string;
    role: string;
  }>('SELECT id, email, name, role FROM users WHERE id = ?', [session.user_id]);

  return { user, session };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { user, session } = getSessionFromRequest(req);
  (req as any).user = user;
  (req as any).session = session;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const { user } = getSessionFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }
  (req as any).user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const { user } = getSessionFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }
  if (user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
    return;
  }
  (req as any).user = user;
  next();
}
