import { NextRequest, NextResponse } from 'next/server';

/* ── Types ── */
type AgentStatus = 'idle' | 'working' | 'on_hold';
type ModelName = string;

interface AgentState {
  id: string;
  name: string;
  status: AgentStatus;
  currentModel: ModelName;
  lastHeartbeat: string; // ISO-8601
}

interface RateLimitEvent {
  timestamp: string;
  endpoint: string;
  retryAfterSeconds: number;
}

interface TeamHealthResponse {
  teamSize: number;
  agents: AgentState[];
  statusCounts: { idle: number; working: number; on_hold: number };
  rateLimitWarning: boolean;
  rateLimitLastTriggered: string | null;
  generatedAt: string;
}

/* ── In-memory persistence (safe for demo/PoC) ── */
const rateLimitLog: RateLimitEvent[] = [];

/* helpers */
function isWithinLast5Minutes(iso: string): boolean {
  const now = Date.now();
  const event = new Date(iso).getTime();
  return now - event <= 5 * 60 * 1000;
}

function computeStatusCounts(agents: AgentState[]) {
  return {
    idle: agents.filter((a) => a.status === 'idle').length,
    working: agents.filter((a) => a.status === 'working').length,
    on_hold: agents.filter((a) => a.status === 'on_hold').length,
  };
}

/* ── Main handler ── */
export async function GET(
  _req: NextRequest
): Promise<NextResponse<TeamHealthResponse | { error: string }>> {
  // Feature flag check
  if (process.env.FEATURE_TEAM_HEALTH_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Feature disabled' }, { status: 503 });
  }

  try {
    const providerUrl =
      process.env.AGENT_PROVIDER_URL ?? 'http://localhost:4000/agents';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    let agentsRaw: unknown;
    try {
      const res = await fetch(providerUrl, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${process.env.AGENT_PROVIDER_SECRET ?? ''}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter =
            parseInt(res.headers.get('Retry-After') ?? '60', 10) || 60;
          rateLimitLog.push({
            timestamp: new Date().toISOString(),
            endpoint: providerUrl,
            retryAfterSeconds: retryAfter,
          });
          return NextResponse.json(
            { error: 'Rate limit reached on agent provider' },
            { status: 502 }
          );
        }
        return NextResponse.json(
          { error: `Provider responded with ${res.status}` },
          { status: 502 }
        );
      }

      agentsRaw = await res.json();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return NextResponse.json(
          { error: 'Timeout querying agent provider' },
          { status: 504 }
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!Array.isArray(agentsRaw)) {
      return NextResponse.json(
        { error: 'Provider returned unexpected format' },
        { status: 502 }
      );
    }

    const agents: AgentState[] = agentsRaw.map((a: any) => ({
      id: String(a.id ?? ''),
      name: String(a.name ?? 'unknown'),
      status: ['idle', 'working', 'on_hold'].includes(a.status)
        ? (a.status as AgentStatus)
        : 'idle',
      currentModel: String(a.currentModel ?? 'N/A'),
      lastHeartbeat: String(a.lastHeartbeat ?? new Date().toISOString()),
    }));

    const recent429 = rateLimitLog
      .slice(-20)
      .filter((e) => isWithinLast5Minutes(e.timestamp));

    const response: TeamHealthResponse = {
      teamSize: agents.length,
      agents,
      statusCounts: computeStatusCounts(agents),
      rateLimitWarning: recent429.length > 0,
      rateLimitLastTriggered:
        recent429.length > 0 ? recent429[recent429.length - 1].timestamp : null,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[team-health] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/* ── Auxiliary endpoint for other services to register 429 events ── */
export async function POST(req: NextRequest) {
  try {
    const body: RateLimitEvent = await req.json();
    if (!body.timestamp || !body.endpoint) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    rateLimitLog.push({
      timestamp: body.timestamp,
      endpoint: body.endpoint,
      retryAfterSeconds: body.retryAfterSeconds ?? 60,
    });
    if (rateLimitLog.length > 100) {
      rateLimitLog.splice(0, rateLimitLog.length - 100);
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  }
}
