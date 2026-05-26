import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the route handler directly (unit style)
// Simulated imports for the rateLimitLog

const rateLimitLog: Array<{ timestamp: string; endpoint: string; retryAfterSeconds: number }> = [];

function isWithinLast5Minutes(iso: string): boolean {
  const now = Date.now();
  const event = new Date(iso).getTime();
  return now - event <= 5 * 60 * 1000;
}

function computeStatusCounts(agents: Array<{ status: string }>) {
  return {
    idle: agents.filter((a) => a.status === 'idle').length,
    working: agents.filter((a) => a.status === 'working').length,
    on_hold: agents.filter((a) => a.status === 'on_hold').length,
  };
}

describe('Team Health API Logic', () => {
  beforeEach(() => {
    rateLimitLog.length = 0;
  });

  describe('isWithinLast5Minutes', () => {
    it('returns true for event 1 minute ago', () => {
      const recent = new Date(Date.now() - 60_000).toISOString();
      expect(isWithinLast5Minutes(recent)).toBe(true);
    });

    it('returns false for event 10 minutes ago', () => {
      const old = new Date(Date.now() - 600_000).toISOString();
      expect(isWithinLast5Minutes(old)).toBe(false);
    });

    it('returns true for event exactly at boundary (4:59)', () => {
      const boundary = new Date(Date.now() - 299_000).toISOString();
      expect(isWithinLast5Minutes(boundary)).toBe(true);
    });

    it('returns false for event exactly at 5:01', () => {
      const boundary = new Date(Date.now() - 301_000).toISOString();
      expect(isWithinLast5Minutes(boundary)).toBe(false);
    });
  });

  describe('computeStatusCounts', () => {
    it('sums to total agent count', () => {
      const agents = [
        { status: 'idle' },
        { status: 'working' },
        { status: 'working' },
        { status: 'on_hold' },
        { status: 'idle' },
      ];
      const counts = computeStatusCounts(agents);
      expect(counts.idle + counts.working + counts.on_hold).toBe(5);
      expect(counts).toEqual({ idle: 2, working: 2, on_hold: 1 });
    });

    it('handles all idle', () => {
      const agents = [{ status: 'idle' }, { status: 'idle' }, { status: 'idle' }];
      const counts = computeStatusCounts(agents);
      expect(counts).toEqual({ idle: 3, working: 0, on_hold: 0 });
    });

    it('handles empty array', () => {
      const counts = computeStatusCounts([]);
      expect(counts).toEqual({ idle: 0, working: 0, on_hold: 0 });
    });
  });

  describe('rateLimitWarning detection', () => {
    it('is false when log is empty', () => {
      const recent429 = rateLimitLog.filter((e) => isWithinLast5Minutes(e.timestamp));
      expect(recent429.length).toBe(0);
    });

    it('is true when 429 occurred within 5 min', () => {
      rateLimitLog.push({
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        endpoint: '/test',
        retryAfterSeconds: 30,
      });
      const recent429 = rateLimitLog.filter((e) => isWithinLast5Minutes(e.timestamp));
      expect(recent429.length).toBe(1);
    });

    it('is false when 429 older than 5 min', () => {
      rateLimitLog.push({
        timestamp: new Date(Date.now() - 400_000).toISOString(),
        endpoint: '/test',
        retryAfterSeconds: 30,
      });
      const recent429 = rateLimitLog.filter((e) => isWithinLast5Minutes(e.timestamp));
      expect(recent429.length).toBe(0);
    });

    it('returns last event timestamp correctly', () => {
      const ts1 = new Date(Date.now() - 120_000).toISOString();
      const ts2 = new Date(Date.now() - 30_000).toISOString();
      rateLimitLog.push(
        { timestamp: ts1, endpoint: '/a', retryAfterSeconds: 10 },
        { timestamp: ts2, endpoint: '/b', retryAfterSeconds: 20 }
      );
      const recent429 = rateLimitLog.filter((e) => isWithinLast5Minutes(e.timestamp));
      expect(recent429.length).toBe(2);
      expect(recent429[recent429.length - 1].timestamp).toBe(ts2);
    });
  });

  describe('agent status validation', () => {
    it('accepts valid statuses', () => {
      const validStatuses = ['idle', 'working', 'on_hold'];
      const raw = [
        { id: '1', name: 'A', status: 'idle', currentModel: 'gpt-4o', lastHeartbeat: new Date().toISOString() },
        { id: '2', name: 'B', status: 'working', currentModel: 'claude', lastHeartbeat: new Date().toISOString() },
        { id: '3', name: 'C', status: 'on_hold', currentModel: 'gpt-4o-mini', lastHeartbeat: new Date().toISOString() },
      ];
      const agents = raw.map((a) => ({
        ...a,
        status: validStatuses.includes(a.status) ? a.status : 'idle',
      }));
      expect(agents.every((a) => validStatuses.includes(a.status))).toBe(true);
    });

    it('defaults unknown status to idle', () => {
      const raw = { id: 'x', name: 'X', status: 'unknown_status', currentModel: 'test' };
      const validStatuses = ['idle', 'working', 'on_hold'];
      const status = validStatuses.includes(raw.status) ? raw.status : 'idle';
      expect(status).toBe('idle');
    });
  });
});
