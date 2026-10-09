import { Request, Response, NextFunction } from 'express';

/**
 * Request counters + latency samples for GET /metrics.
 * Kept in-process; reset on server restart.
 */
export interface RequestMetrics {
  counts: Record<string, number>;
  latencies: number[];
  startedAt: number;
}

const metrics: RequestMetrics = {
  counts: {},
  latencies: [],
  startedAt: Date.now(),
};

function recordLatency(ms: number): void {
  metrics.latencies.push(ms);
  // Keep the last 1000 samples
  if (metrics.latencies.length > 1000) {
    metrics.latencies.shift();
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

/** Prometheus text exposition format (intentionally dependency-free). */
export function renderMetrics(): string {
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const total = Object.values(metrics.counts).reduce((s, n) => s + n, 0);
  const lines: string[] = [];
  lines.push(
    '# HELP prism_requests_total Total HTTP requests by route and status.',
  );
  lines.push('# TYPE prism_requests_total counter');
  for (const [key, count] of Object.entries(metrics.counts)) {
    const [route, status] = key.split('|');
    lines.push(
      `prism_requests_total{route="${route}",status="${status}"} ${count}`,
    );
  }
  lines.push(
    '# HELP prism_request_duration_ms Request duration in milliseconds.',
  );
  lines.push('# TYPE prism_request_duration_ms summary');
  lines.push(
    `prism_request_duration_ms{quantile="0.5"} ${percentile(sorted, 50)}`,
  );
  lines.push(
    `prism_request_duration_ms{quantile="0.95"} ${percentile(sorted, 95)}`,
  );
  lines.push(
    `prism_request_duration_ms{quantile="0.99"} ${percentile(sorted, 99)}`,
  );
  lines.push(`prism_requests_total_all ${total}`);
  lines.push(
    `prism_uptime_seconds ${Math.floor((Date.now() - metrics.startedAt) / 1000)}`,
  );
  return `${lines.join('\n')}\n`;
}

/** Structured request logger: JSON lines to stdout + metrics recording. */
export const logger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const route = req.baseUrl + req.route?.path || req.path;
    const key = `${route}|${res.statusCode}`;
    metrics.counts[key] = (metrics.counts[key] ?? 0) + 1;
    recordLatency(duration);

    // JSON line so any log collector can parse without regex
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: res.statusCode >= 500 ? 'error' : 'info',
        channel: 'system',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      }),
    );
  });

  next();
};
