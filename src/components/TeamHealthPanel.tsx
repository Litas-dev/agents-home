import { useTeamHealth } from '@/hooks/useTeamHealth';

type AgentStatus = 'idle' | 'working' | 'on_hold';

interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  currentModel: string | null;
  lastActive: string;
}

interface TeamHealthData {
  teamSize: number;
  agents: Agent[];
  statusCounts: { idle: number; working: number; on_hold: number };
  rateLimitWarning: boolean;
  rateLimitLastTriggered: string | null;
  generatedAt: string;
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: 'bg-gray-400',
  working: 'bg-green-500',
  on_hold: 'bg-amber-500',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  on_hold: 'On Hold',
};

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      data-testid="agent-status"
      data-status={status}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${STATUS_COLORS[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function TeamHealthPanel() {
  const { data, error, isLoading, refetch } = useTeamHealth();

  if (isLoading) {
    return (
      <div data-testid="team-health-panel" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-32 rounded bg-gray-200" />
          <div className="h-12 w-full rounded bg-gray-100" />
          <div className="h-8 w-48 rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="team-health-panel" data-testid="team-health-error" className="rounded-lg border border-red-200 bg-red-50 p-5 shadow-sm">
        <p className="text-sm font-medium text-red-800">Failed to load team health data.</p>
        <p className="mt-1 text-xs text-red-600">{error}</p>
        <button
          onClick={refetch}
          className="mt-3 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.teamSize === 0) {
    return (
      <div data-testid="team-health-panel" className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">Team Health</h2>
        <p data-testid="agent-count" className="mt-1 text-2xl font-bold text-gray-900">0</p>
        <p data-testid="empty-team-msg" className="text-xs text-gray-500">No agents active</p>
      </div>
    );
  }

  return (
    <div data-testid="team-health-panel" className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Rate Limit Warning Banner */}
      {data.rateLimitWarning && (
        <div
          data-testid="rate-limit-warning"
          role="alert"
          className="flex items-center gap-2 rounded-t-lg border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm"
        >
          <span className="text-amber-600">⚠️</span>
          <span className="font-medium text-amber-800">OpenRouter rate limit (429) triggered</span>
          {data.rateLimitLastTriggered && (
            <span className="text-xs text-amber-600">
              at {new Date(data.rateLimitLastTriggered).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Summary Bar */}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Team Health</h2>
            <p className="mt-1 text-3xl font-bold text-gray-900">
              <span data-testid="agent-count">{data.teamSize}</span>
            </p>
            <p className="text-xs text-gray-500">total agents</p>
          </div>
          <div className="flex gap-4 text-sm">
            <div className="text-center">
              <p className="font-semibold text-gray-700">{data.statusCounts.idle}</p>
              <p className="text-xs text-gray-500">idle</p>
            </div>
            <div className="text-center">
              <p className="font-semibold text-green-600">{data.statusCounts.working}</p>
              <p className="text-xs text-gray-500">working</p>
            </div>
            <div className="text-center">
              <p className="font-semibold text-amber-600">{data.statusCounts.on_hold}</p>
              <p className="text-xs text-gray-500">on hold</p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent List */}
      <div className="border-t border-gray-100">
        {data.agents.map((agent) => (
          <div
            key={agent.id}
            data-testid="agent-row"
            className="flex items-center justify-between border-b border-gray-50 px-5 py-3 last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <StatusBadge status={agent.status} />
              <span className="text-sm font-medium text-gray-800">{agent.name}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span data-testid="agent-model" className="rounded bg-gray-100 px-2 py-0.5 font-mono">
                {agent.currentModel ?? 'N/A'}
              </span>
              <span title={agent.lastActive}>
                {new Date(agent.lastActive).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-2">
        <span className="text-xs text-gray-400">
          Updated {new Date(data.generatedAt).toLocaleTimeString()}
        </span>
        <button
          onClick={refetch}
          className="text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
