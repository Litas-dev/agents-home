import { useState, useEffect, useCallback, useRef } from 'react';

interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'on_hold';
  currentModel: string | null;
  lastActive: string;
}

interface TeamHealthResponse {
  teamSize: number;
  agents: Agent[];
  statusCounts: { idle: number; working: number; on_hold: number };
  rateLimitWarning: boolean;
  rateLimitLastTriggered: string | null;
  generatedAt: string;
}

interface UseTeamHealthResult {
  data: TeamHealthResponse | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => void;
}

const POLL_INTERVAL_MS =
  parseInt(process.env.NEXT_PUBLIC_TEAM_HEALTH_POLL_INTERVAL ?? '30000', 10) || 30000;

export function useTeamHealth(): UseTeamHealthResult {
  const [data, setData] = useState<TeamHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/team-health', { signal: controller.signal });

      if (!res.ok) {
        if (res.status === 503) {
          setError('Team Health feature is disabled.');
          setData(null);
          return;
        }
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json: TeamHealthResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message || 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchData]);

  return { data, error, isLoading, refetch: fetchData };
}
