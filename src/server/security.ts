import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, run } from './db.js';

export type RiskLevel = 'NORMAL' | 'SUSPICIOUS' | 'HIGH_RISK' | 'ABUSIVE';

interface RateLimitBucket {
  timestamps: number[];
  inFlight: number;
}

// In-memory sliding window rate limiter & session telemetry
const rateLimitMap = new Map<string, RateLimitBucket>();
const sessionStatsMap = new Map<string, {
  requestTimestamps: number[];
  endpointCounts: Record<string, number>;
  captchaFailures: number;
  parallelPeaks: number;
  burstCount: number;
  lastAssessedRisk: RiskLevel;
  lastAssessedScore: number;
  isRestricted: boolean;
  restrictionReason?: string;
}>();

// Global request metrics for Sentinel Admin & live drop
export const liveSecurityStats = {
  totalRequests: 0,
  blockedRequests: 0,
  mitigatedRequests: 0,
  suspiciousRequests: 0,
  activeRestrictedSessions: 0,
  recentEvents: [] as Array<{
    id: string;
    type: string;
    severity: string;
    sessionId: string;
    description: string;
    actionTaken: string;
    timestamp: string;
  }>,
  rpsCounter: 0,
  currentRps: 0,
  p95Latencies: [] as number[],
};

// Periodic RPS calculator
setInterval(() => {
  liveSecurityStats.currentRps = liveSecurityStats.rpsCounter;
  liveSecurityStats.rpsCounter = 0;
}, 1000);

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

export function logSecurityEvent(params: {
  eventType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sessionId: string;
  userId?: string;
  ipAddress: string;
  description: string;
  actionTaken: string;
  details?: Record<string, any>;
}): void {
  const eventId = `sec_${uuidv4().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  const detailsStr = JSON.stringify(params.details || {});

  try {
    run(`
      INSERT INTO security_events (id, event_type, severity, session_id, user_id, ip_address, description, details_json, action_taken, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      eventId,
      params.eventType,
      params.severity,
      params.sessionId,
      params.userId || null,
      params.ipAddress,
      params.description,
      detailsStr,
      params.actionTaken,
      now
    ]);

    liveSecurityStats.recentEvents.unshift({
      id: eventId,
      type: params.eventType,
      severity: params.severity,
      sessionId: params.sessionId,
      description: params.description,
      actionTaken: params.actionTaken,
      timestamp: now
    });

    if (liveSecurityStats.recentEvents.length > 50) {
      liveSecurityStats.recentEvents.pop();
    }
  } catch (err) {
    console.error('Failed to log security event to DB:', err);
  }
}

// Ingest signals & calculate graduated risk level
export function evaluateSessionRisk(sessionId: string, userId?: string, ip: string = '127.0.0.1'): {
  level: RiskLevel;
  score: number;
  burstCount: number;
  retryCount: number;
  parallelCount: number;
} {
  const now = Date.now();
  let stats = sessionStatsMap.get(sessionId);
  if (!stats) {
    stats = {
      requestTimestamps: [],
      endpointCounts: {},
      captchaFailures: 0,
      parallelPeaks: 0,
      burstCount: 0,
      lastAssessedRisk: 'NORMAL',
      lastAssessedScore: 0,
      isRestricted: false
    };
    sessionStatsMap.set(sessionId, stats);
  }

  // Filter last 30 seconds
  const windowStart = now - 30000;
  stats.requestTimestamps = stats.requestTimestamps.filter(t => t > windowStart);

  // Check bursts (e.g. > 12 requests within 1000ms)
  const oneSecAgo = now - 1000;
  const inLastSecond = stats.requestTimestamps.filter(t => t > oneSecAgo).length;
  if (inLastSecond > 10) {
    stats.burstCount += 1;
  }

  // Max duplicate endpoint attempts
  let maxRetry = 0;
  for (const count of Object.values(stats.endpointCounts)) {
    if (count > maxRetry) maxRetry = count;
  }

  // Calculate composite risk score (0 to 100)
  let score = 0;
  // Request velocity component
  score += Math.min(stats.requestTimestamps.length * 1.2, 35);
  // Burst spike component
  score += Math.min(stats.burstCount * 15, 40);
  // CAPTCHA failure penalty
  score += Math.min(stats.captchaFailures * 20, 40);
  // Parallel concurrency penalty
  score += Math.min(stats.parallelPeaks * 10, 30);
  // Duplicate endpoint retries
  if (maxRetry > 15) score += 20;

  let level: RiskLevel = 'NORMAL';
  if (score >= 80 || stats.isRestricted) {
    level = 'ABUSIVE';
  } else if (score >= 50) {
    level = 'HIGH_RISK';
  } else if (score >= 20) {
    level = 'SUSPICIOUS';
  }

  stats.lastAssessedRisk = level;
  stats.lastAssessedScore = score;

  // Persist assessment in DB
  try {
    run(`
      INSERT OR REPLACE INTO risk_assessments (id, session_id, user_id, risk_level, risk_score, burst_count, retry_count, parallel_count, evaluated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      `risk_${sessionId}`,
      sessionId,
      userId || null,
      level,
      score,
      stats.burstCount,
      maxRetry,
      stats.parallelPeaks,
      new Date().toISOString()
    ]);
  } catch (err) {
    // Ignore db race
  }

  return {
    level,
    score,
    burstCount: stats.burstCount,
    retryCount: maxRetry,
    parallelCount: stats.parallelPeaks
  };
}

export function recordCaptchaFailure(sessionId: string, ip: string, userId?: string): void {
  let stats = sessionStatsMap.get(sessionId);
  if (!stats) {
    evaluateSessionRisk(sessionId, userId, ip);
    stats = sessionStatsMap.get(sessionId)!;
  }
  stats.captchaFailures += 1;
  logSecurityEvent({
    eventType: 'CAPTCHA_FAILURE',
    severity: 'MEDIUM',
    sessionId,
    userId,
    ipAddress: ip,
    description: `Failed CAPTCHA challenge attempt #${stats.captchaFailures}`,
    actionTaken: 'CHALLENGE_RETRY_INCREMENTED'
  });
}

export function restrictSession(sessionId: string, reason: string): void {
  let stats = sessionStatsMap.get(sessionId);
  if (!stats) {
    evaluateSessionRisk(sessionId);
    stats = sessionStatsMap.get(sessionId)!;
  }
  stats.isRestricted = true;
  stats.restrictionReason = reason;
  stats.lastAssessedRisk = 'ABUSIVE';
  liveSecurityStats.activeRestrictedSessions = Array.from(sessionStatsMap.values()).filter(s => s.isRestricted).length;
}

export function unrestrictSession(sessionId: string): void {
  const stats = sessionStatsMap.get(sessionId);
  if (stats) {
    stats.isRestricted = false;
    stats.lastAssessedRisk = 'NORMAL';
    stats.lastAssessedScore = 0;
    stats.burstCount = 0;
    stats.captchaFailures = 0;
  }
  liveSecurityStats.activeRestrictedSessions = Array.from(sessionStatsMap.values()).filter(s => s.isRestricted).length;
}

// Server-side sliding window rate limiter middleware factory
export function createRateLimiter(options: {
  keyPrefix: string;
  limit: number;
  windowMs: number;
  actionName: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    liveSecurityStats.totalRequests += 1;
    liveSecurityStats.rpsCounter += 1;

    const ip = getClientIp(req);
    const session = (req as any).session;
    const sessionId = session ? session.id : `ip_${ip.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const rateKey = `${options.keyPrefix}:${sessionId}`;
    const now = Date.now();

    let bucket = rateLimitMap.get(rateKey);
    if (!bucket) {
      bucket = { timestamps: [], inFlight: 0 };
      rateLimitMap.set(rateKey, bucket);
    }

    // Clean expired timestamps
    bucket.timestamps = bucket.timestamps.filter(t => t > now - options.windowMs);

    // Track session telemetry
    let stats = sessionStatsMap.get(sessionId);
    if (!stats) {
      stats = {
        requestTimestamps: [],
        endpointCounts: {},
        captchaFailures: 0,
        parallelPeaks: 0,
        burstCount: 0,
        lastAssessedRisk: 'NORMAL',
        lastAssessedScore: 0,
        isRestricted: false
      };
      sessionStatsMap.set(sessionId, stats);
    }
    stats.requestTimestamps.push(now);
    const ep = req.path;
    stats.endpointCounts[ep] = (stats.endpointCounts[ep] || 0) + 1;

    bucket.inFlight += 1;
    if (bucket.inFlight > stats.parallelPeaks) {
      stats.parallelPeaks = bucket.inFlight;
    }

    const onFinish = () => {
      if (bucket) bucket.inFlight = Math.max(0, bucket.inFlight - 1);
    };
    res.on('finish', onFinish);
    res.on('close', onFinish);

    // Evaluate risk
    const risk = evaluateSessionRisk(sessionId, (req as any).user?.id, ip);

    // Graduated Mitigation rules
    if (risk.level === 'ABUSIVE') {
      liveSecurityStats.blockedRequests += 1;
      logSecurityEvent({
        eventType: 'ABUSE_MITIGATION_BLOCKED',
        severity: 'HIGH',
        sessionId,
        userId: (req as any).user?.id,
        ipAddress: ip,
        description: `Blocked high-velocity request to ${options.actionName} (Risk Score: ${risk.score.toFixed(1)})`,
        actionTaken: 'REQUEST_BLOCKED_SAFE_ERROR',
        details: { endpoint: req.path, risk }
      });

      res.status(429).json({
        error: 'Unusual activity detected. Please complete verification and try again.',
        code: 'ACTIVITY_RESTRICTED',
        retryAfter: 10
      });
      return;
    }

    if (bucket.timestamps.length >= options.limit) {
      liveSecurityStats.mitigatedRequests += 1;
      logSecurityEvent({
        eventType: 'RATE_LIMIT_EXCEEDED',
        severity: 'MEDIUM',
        sessionId,
        userId: (req as any).user?.id,
        ipAddress: ip,
        description: `Rate limit hit for ${options.actionName} (${bucket.timestamps.length}/${options.limit} within ${options.windowMs / 1000}s)`,
        actionTaken: 'THROTTLED_429'
      });

      res.status(429).json({
        error: 'Too many requests. Please wait a moment before trying again.',
        code: 'RATE_LIMITED',
        retryAfter: Math.ceil(options.windowMs / 1000)
      });
      return;
    }

    bucket.timestamps.push(now);

    // Suspicious clients experience graduated backpressure delay (200ms) without outright crash
    if (risk.level === 'SUSPICIOUS' || risk.level === 'HIGH_RISK') {
      liveSecurityStats.suspiciousRequests += 1;
      setTimeout(() => {
        next();
      }, 150);
      return;
    }

    next();
  };
}

export function getSessionAbuseDetails(sessionId: string) {
  const stats = sessionStatsMap.get(sessionId);
  if (!stats) return null;
  return {
    sessionId,
    riskLevel: stats.lastAssessedRisk,
    riskScore: stats.lastAssessedScore,
    burstCount: stats.burstCount,
    captchaFailures: stats.captchaFailures,
    parallelPeaks: stats.parallelPeaks,
    isRestricted: stats.isRestricted,
    totalRecentRequests: stats.requestTimestamps.length
  };
}
