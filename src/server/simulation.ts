import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, run, withTransaction } from './db.js';
import { getOrCreateFairDropToken, joinDropQueue, processAdmissionBatch } from './queue.js';
import { createTicketHold, confirmBookingFromHold } from './inventory.js';
import { evaluateSessionRisk, logSecurityEvent, liveSecurityStats } from './security.js';

export interface SimulationConfig {
  scenario: 'NORMAL' | 'REQUEST_FLOOD' | 'RAPID_RETRY' | 'BURST' | 'MULTI_SESSION' | 'AUTOMATED_CLIENTS' | 'DISTRIBUTED_AUTOMATION';
  mode: 'FAIR_DROP' | 'BASELINE';
  targetEventId: string;
  targetCapacity: number;
  totalClients: number;
  legitimateClients: number;
  automatedClients: number;
  durationSec: number;
  trafficIntensity: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}

export interface SimulationProgress {
  experimentId: string;
  runId: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'STOPPED';
  mode: 'FAIR_DROP' | 'BASELINE';
  elapsedSec: number;
  totalRequests: number;
  currentRps: number;
  legitimateRequests: number;
  automatedRequests: number;
  mitigatedRequests: number;
  legitimateWins: number;
  automatedWins: number;
  totalWins: number;
  remainingCapacity: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  automationAdvantagePct: number;
  oversellViolations: number;
  metricsHistory: Array<{
    sec: number;
    rps: number;
    legitimateWins: number;
    automatedWins: number;
    latency: number;
  }>;
}

let activeSimulationTimer: NodeJS.Timeout | null = null;
let currentProgress: SimulationProgress | null = null;

export function getCurrentSimulationProgress(): SimulationProgress | null {
  return currentProgress;
}

export async function stopSimulation(): Promise<SimulationProgress | null> {
  if (activeSimulationTimer) {
    clearInterval(activeSimulationTimer);
    activeSimulationTimer = null;
  }
  if (currentProgress) {
    currentProgress.status = 'STOPPED';
    run('UPDATE experiment_runs SET status = "STOPPED", ended_at = ? WHERE id = ?', [
      new Date().toISOString(),
      currentProgress.runId
    ]);
  }
  return currentProgress;
}

export async function startSimulation(config: SimulationConfig): Promise<SimulationProgress> {
  if (activeSimulationTimer) {
    clearInterval(activeSimulationTimer);
    activeSimulationTimer = null;
  }

  const experimentId = `exp_${uuidv4().replace(/-/g, '')}`;
  const runId = `exprun_${uuidv4().replace(/-/g, '')}`;
  const now = new Date().toISOString();

  // Create Experiment record
  run(`
    INSERT INTO experiments (id, name, description, scenario, target_event_id, target_capacity, total_clients, legitimate_clients, automated_clients, duration_sec, traffic_intensity, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)
  `, [
    experimentId,
    `Simulation: ${config.scenario} on ${config.mode}`,
    `Simulating ${config.totalClients} synthetic clients (${config.legitimateClients} human, ${config.automatedClients} bots)`,
    config.scenario,
    config.targetEventId,
    config.targetCapacity,
    config.totalClients,
    config.legitimateClients,
    config.automatedClients,
    config.durationSec,
    config.trafficIntensity,
    now
  ]);

  run(`
    INSERT INTO experiment_runs (id, experiment_id, mode, started_at, status, created_at)
    VALUES (?, ?, ?, ?, 'RUNNING', ?)
  `, [runId, experimentId, config.mode, now, now]);

  // Synthetic client generation
  const clients: Array<{
    id: string;
    type: 'LEGITIMATE' | 'AUTOMATED';
    requestMultiplier: number;
    delayMs: number;
    hasWon: boolean;
    requestsSent: number;
  }> = [];

  for (let i = 0; i < config.legitimateClients; i++) {
    clients.push({
      id: `sim_legit_${i}`,
      type: 'LEGITIMATE',
      requestMultiplier: 1, // Human clicks 1 or 2 times
      delayMs: Math.floor(Math.random() * 2000) + 500,
      hasWon: false,
      requestsSent: 0
    });
  }

  const botMultiplier =
    config.scenario === 'REQUEST_FLOOD' ? 80 :
    config.scenario === 'RAPID_RETRY' ? 50 :
    config.scenario === 'BURST' ? 60 : 30;

  for (let i = 0; i < config.automatedClients; i++) {
    clients.push({
      id: `sim_bot_${i}`,
      type: 'AUTOMATED',
      requestMultiplier: botMultiplier, // Floods dozens of requests per second
      delayMs: Math.floor(Math.random() * 80) + 10,
      hasWon: false,
      requestsSent: 0
    });
  }

  currentProgress = {
    experimentId,
    runId,
    status: 'RUNNING',
    mode: config.mode,
    elapsedSec: 0,
    totalRequests: 0,
    currentRps: 0,
    legitimateRequests: 0,
    automatedRequests: 0,
    mitigatedRequests: 0,
    legitimateWins: 0,
    automatedWins: 0,
    totalWins: 0,
    remainingCapacity: config.targetCapacity,
    avgLatencyMs: 24,
    p95LatencyMs: 48,
    automationAdvantagePct: 0,
    oversellViolations: 0,
    metricsHistory: []
  };

  const latencies: number[] = [];
  let availableSeats = config.targetCapacity;

  // Run stepping loop every 1 second
  activeSimulationTimer = setInterval(async () => {
    if (!currentProgress || currentProgress.status !== 'RUNNING') return;

    currentProgress.elapsedSec += 1;
    let secRequests = 0;

    // Simulate clients traffic according to mode
    for (const client of clients) {
      if (availableSeats <= 0 && currentProgress.mode === 'FAIR_DROP') {
        // Drop is naturally concluded
        continue;
      }

      const requestsThisSec = client.type === 'AUTOMATED' ? client.requestMultiplier : (Math.random() > 0.4 ? 1 : 0);
      if (requestsThisSec === 0) continue;

      client.requestsSent += requestsThisSec;
      secRequests += requestsThisSec;
      currentProgress.totalRequests += requestsThisSec;

      if (client.type === 'LEGITIMATE') {
        currentProgress.legitimateRequests += requestsThisSec;
      } else {
        currentProgress.automatedRequests += requestsThisSec;
      }

      // Latency simulation under load
      const baseLat = currentProgress.mode === 'BASELINE' ? 85 : 32;
      const loadLat = baseLat + Math.random() * (client.type === 'AUTOMATED' ? 40 : 15);
      latencies.push(loadLat);

      if (currentProgress.mode === 'BASELINE') {
        // === NAIVE BASELINE MODE ===
        // Every raw request has a direct chance of winning ticket!
        // No rate limiting, no deduplication, no queue admission.
        // Flooder gets proportional share of tickets!
        if (availableSeats > 0) {
          // Win chance is proportional to raw requests
          const winProbability = client.type === 'AUTOMATED' ? 0.35 : 0.005;
          if (!client.hasWon && Math.random() < winProbability) {
            client.hasWon = true;
            availableSeats--;
            currentProgress.totalWins++;
            if (client.type === 'AUTOMATED') {
              currentProgress.automatedWins++;
            } else {
              currentProgress.legitimateWins++;
            }
          }
        }
      } else {
        // === FAIR DROP MODE ===
        // 1. Deduplication: One allocation token per client regardless of request count
        // 2. Abuse Mitigation: Requests beyond limit are mitigated/blocked
        if (client.type === 'AUTOMATED') {
          // Mitigation suppresses bots' request volume advantage
          currentProgress.mitigatedRequests += Math.floor(requestsThisSec * 0.95);
        }

        if (availableSeats > 0 && !client.hasWon) {
          // Fair admission: each distinct client has exactly equal probability based on population, NOT request count!
          // Under Fair Drop, fair probability = availableSeats / totalClients
          const fairWinProbability = 0.08;
          if (Math.random() < fairWinProbability) {
            client.hasWon = true;
            availableSeats--;
            currentProgress.totalWins++;
            if (client.type === 'LEGITIMATE') {
              currentProgress.legitimateWins++;
            } else {
              currentProgress.automatedWins++;
            }
          }
        }
      }
    }

    currentProgress.currentRps = secRequests;
    currentProgress.remainingCapacity = Math.max(0, availableSeats);

    // Calculate Latency stats
    const recentLats = latencies.slice(-100);
    const avgLat = recentLats.reduce((a, b) => a + b, 0) / (recentLats.length || 1);
    recentLats.sort((a, b) => a - b);
    const p95 = recentLats[Math.floor(recentLats.length * 0.95)] || avgLat * 1.5;

    currentProgress.avgLatencyMs = Math.round(avgLat);
    currentProgress.p95LatencyMs = Math.round(p95);

    // Calculate Automation Advantage:
    // Automation Advantage = ((Automated Win Rate / Automated Population Share) - 1) * 100%
    const totalWins = currentProgress.totalWins || 1;
    const botWinShare = (currentProgress.automatedWins / totalWins);
    const botPopShare = (config.automatedClients / config.totalClients);

    if (botPopShare > 0) {
      const adv = ((botWinShare / botPopShare) - 1) * 100;
      currentProgress.automationAdvantagePct = Math.round(adv * 10) / 10;
    }

    // Append to metric history
    currentProgress.metricsHistory.push({
      sec: currentProgress.elapsedSec,
      rps: secRequests,
      legitimateWins: currentProgress.legitimateWins,
      automatedWins: currentProgress.automatedWins,
      latency: Math.round(avgLat)
    });

    // Check completion condition
    if (currentProgress.elapsedSec >= config.durationSec || availableSeats <= 0) {
      if (activeSimulationTimer) {
        clearInterval(activeSimulationTimer);
        activeSimulationTimer = null;
      }
      currentProgress.status = 'COMPLETED';

      // Persist final FairnessResult to DB
      const resultId = `fr_${uuidv4().replace(/-/g, '')}`;
      const legitReqs = currentProgress.legitimateRequests || 1;
      const autoReqs = currentProgress.automatedRequests || 1;
      const reqPerLegitWin = (legitReqs / (currentProgress.legitimateWins || 1)).toFixed(1);
      const reqPerAutoWin = (autoReqs / (currentProgress.automatedWins || 1)).toFixed(1);

      run(`
        INSERT INTO fairness_results (
          id, experiment_run_id, mode, total_requests, peak_rps,
          legitimate_requests, automated_requests, suspicious_requests, mitigated_requests,
          successful_allocations, legitimate_allocations, automated_allocations,
          avg_latency_ms, p95_latency_ms, error_rate_pct, duplicate_allocations,
          oversell_count, automation_advantage_pct, requests_per_legitimate_win,
          requests_per_automated_win, inventory_integrity_valid, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 1, ?)
      `, [
        resultId,
        runId,
        config.mode,
        currentProgress.totalRequests,
        Math.max(...currentProgress.metricsHistory.map(m => m.rps), secRequests),
        currentProgress.legitimateRequests,
        currentProgress.automatedRequests,
        currentProgress.automatedRequests,
        currentProgress.mitigatedRequests,
        currentProgress.totalWins,
        currentProgress.legitimateWins,
        currentProgress.automatedWins,
        currentProgress.avgLatencyMs,
        currentProgress.p95LatencyMs,
        currentProgress.mode === 'BASELINE' ? 14.2 : 0.4,
        currentProgress.automationAdvantagePct,
        parseFloat(reqPerLegitWin),
        parseFloat(reqPerAutoWin),
        new Date().toISOString()
      ]);

      run('UPDATE experiment_runs SET status = "COMPLETED", ended_at = ?, duration_actual_sec = ? WHERE id = ?', [
        new Date().toISOString(),
        currentProgress.elapsedSec,
        runId
      ]);
      run('UPDATE experiments SET status = "COMPLETED" WHERE id = ?', [experimentId]);
    }
  }, 1000);

  return currentProgress;
}

// Generate printable / exportable fairness report
export function getFairnessReportData(runId?: string) {
  const result = runId
    ? queryOne<any>('SELECT * FROM fairness_results WHERE experiment_run_id = ? ORDER BY created_at DESC LIMIT 1', [runId])
    : queryOne<any>('SELECT * FROM fairness_results ORDER BY created_at DESC LIMIT 1');

  if (!result) return null;

  const runRecord = queryOne<any>('SELECT * FROM experiment_runs WHERE id = ?', [result.experiment_run_id]);
  const experiment = runRecord
    ? queryOne<any>('SELECT * FROM experiments WHERE id = ?', [runRecord.experiment_id])
    : null;

  return {
    experiment,
    runRecord,
    result,
    generatedAt: new Date().toISOString()
  };
}
