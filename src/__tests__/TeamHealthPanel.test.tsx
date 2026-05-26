import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeamHealthPanel from '../components/TeamHealthPanel';

const mockUseTeamHealth = vi.fn();

vi.mock('@/hooks/useTeamHealth', () => ({
  useTeamHealth: () => mockUseTeamHealth(),
}));

const mockData = {
  teamSize: 5,
  statusCounts: { idle: 2, working: 2, on_hold: 1 },
  agents: [
    { id: 'a1', name: 'Alice', status: 'idle', currentModel: 'gpt-4o', lastActive: '2025-01-01T10:00:00Z' },
    { id: 'a2', name: 'Bob', status: 'working', currentModel: 'claude-3-opus', lastActive: '2025-01-01T10:05:00Z' },
    { id: 'a3', name: 'Carol', status: 'working', currentModel: 'gpt-4o', lastActive: '2025-01-01T10:10:00Z' },
    { id: 'a4', name: 'Dan', status: 'on_hold', currentModel: 'gpt-4o-mini', lastActive: '2025-01-01T09:55:00Z' },
    { id: 'a5', name: 'Eve', status: 'idle', currentModel: 'claude-3-opus', lastActive: '2025-01-01T10:02:00Z' },
  ],
  rateLimitWarning: false,
  rateLimitLastTriggered: null,
  generatedAt: '2025-01-01T10:15:00Z',
};

describe('TeamHealthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTeamHealth.mockReturnValue({
      data: mockData,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  it('renders total agent count', () => {
    render(<TeamHealthPanel />);
    expect(screen.getByTestId('agent-count')).toHaveTextContent('5');
    expect(screen.getByText(/total agents/i)).toBeInTheDocument();
  });

  it('renders status breakdown', () => {
    render(<TeamHealthPanel />);
    expect(screen.getByText('2')).toBeInTheDocument(); // idle count
    expect(screen.getByText('1')).toBeInTheDocument(); // on_hold count
  });

  it('lists each agent with model', () => {
    render(<TeamHealthPanel />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('claude-3-opus')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
  });

  it('shows rate-limit warning banner when triggered', () => {
    const warned = {
      ...mockData,
      rateLimitWarning: true,
      rateLimitLastTriggered: '2025-01-01T10:14:00Z',
    };
    mockUseTeamHealth.mockReturnValue({
      data: warned,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<TeamHealthPanel />);
    expect(screen.getByTestId('rate-limit-warning')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/429/i)).toBeInTheDocument();
  });

  it('hides rate-limit banner when false', () => {
    render(<TeamHealthPanel />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders status badges with correct data attributes', () => {
    render(<TeamHealthPanel />);
    const statusElements = screen.getAllByTestId('agent-status');
    const statuses = statusElements.map((el) => el.getAttribute('data-status'));
    expect(statuses).toContain('idle');
    expect(statuses).toContain('working');
    expect(statuses).toContain('on_hold');
  });

  it('shows loading skeleton when isLoading', () => {
    mockUseTeamHealth.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
      refetch: vi.fn(),
    });
    render(<TeamHealthPanel />);
    expect(screen.getByTestId('team-health-panel').querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows error state with retry button', () => {
    const mockRefetch = vi.fn();
    mockUseTeamHealth.mockReturnValue({
      data: null,
      error: 'Network error',
      isLoading: false,
      refetch: mockRefetch,
    });
    render(<TeamHealthPanel />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('handles empty team gracefully', () => {
    mockUseTeamHealth.mockReturnValue({
      data: { ...mockData, teamSize: 0, agents: [], statusCounts: { idle: 0, working: 0, on_hold: 0 } },
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    });
    render(<TeamHealthPanel />);
    expect(screen.getByTestId('agent-count')).toHaveTextContent('0');
    expect(screen.getByTestId('empty-team-msg')).toBeVisible();
  });

  it('renders refresh button that calls refetch', () => {
    const mockRefetch = vi.fn();
    mockUseTeamHealth.mockReturnValue({
      data: mockData,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    render(<TeamHealthPanel />);
    fireEvent.click(screen.getByText('Refresh'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
