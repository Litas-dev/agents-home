import { create } from 'zustand';
import { getAllAgents } from '../../data/agents';
import { AgentState, CharacterState } from '../../types';
import { useTeamStore, getActiveAgentSet } from './teamStore';
import { DEFAULT_MODELS } from '../../core/llm/constants';
import { AVAILABLE_MODELS } from '../../core/llm/constants';

export const useUiStore = create<CharacterState>()(
  (set) => ({
    isThinking: false,
    instanceCount: getAllAgents(getActiveAgentSet()).length + 1, // +1 for user

    selectedNpcIndex: null,
    selectedPosition: null,
    hoveredNpcIndex: null,
    hoveredPoiId: null,
    hoveredPoiLabel: null,
    hoverPosition: null,
    npcScreenPositions: {},
    isChatting: false,
    isTyping: false,
    chatMessages: [],
    inspectorTab: 'info',
    agentStatuses: {},
    setAgentStatus: (index: number, status: AgentState) => set((s) => ({
      agentStatuses: { ...s.agentStatuses, [index]: status }
    })),

    isBYOKOpen: false,
    byokError: null,
    setBYOKOpen: (open: boolean, error: string | null = null) =>
      set({ isBYOKOpen: open, byokError: error }),

    isGitHubOpen: false,
    setGitHubOpen: (open: boolean) => set({ isGitHubOpen: open }),

    githubConfig: (() => {
      try {
        const saved = localStorage.getItem('github-config');
        if (saved) {
          const parsed = JSON.parse(saved);
          return {
            token: parsed.token || '',
            repo: parsed.repo || '',
            baseBranch: parsed.baseBranch || 'main',
          };
        }
      } catch { }
      return { token: '', repo: '', baseBranch: 'main' };
    })(),

    setGitHubConfig: (config) => set((s) => ({ githubConfig: { ...s.githubConfig, ...config } })),

    activeAuditTaskId: null,
    setActiveAuditTaskId: (taskId: string | null) => set({ activeAuditTaskId: taskId }),

    llmConfig: (() => {
      try {
        const saved = localStorage.getItem('byok-config');
        if (saved) {
          const parsed = JSON.parse(saved);
          const provider = 'deepseek';
          const defaultBaseUrl = 'https://api.deepseek.com';
          const rawBaseUrl = typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '';
          const baseUrl = rawBaseUrl.includes('openrouter.ai') ? defaultBaseUrl : (rawBaseUrl || defaultBaseUrl);
          const rawModel = String(parsed.model || '');
          const model = AVAILABLE_MODELS.text.includes(rawModel as any) ? rawModel : DEFAULT_MODELS.text;
          return {
            provider,
            apiKey: parsed.apiKey || '',
            baseUrl,
            model
          };
        }
      } catch { }
      return {
        provider: 'deepseek',
        apiKey: '',
        baseUrl: 'https://api.deepseek.com',
        model: DEFAULT_MODELS.text
      };
    })(),

    setThinking: (isThinking: boolean) => set({ isThinking }),
    setIsTyping: (isTyping: boolean) => set({ isTyping }),
    setInspectorTab: (tab: 'info' | 'chat') => set({ inspectorTab: tab }),
    setInstanceCount: (count: number) => set({ instanceCount: count }),

    setSelectedNpc: (index: number | null) => set({
      selectedNpcIndex: index,
      selectedPosition: null,
    }),
    setSelectedPosition: (pos: { x: number; y: number } | null) => set({ selectedPosition: pos }),
    setHoveredNpc: (index: number | null, pos: { x: number; y: number } | null) => set({
      hoveredNpcIndex: index,
      hoverPosition: pos,
      hoveredPoiId: null,
      hoveredPoiLabel: null,
    }),
    setHoveredPoi: (id: string | null, label: string | null, pos: { x: number; y: number } | null) => set({
      hoveredPoiId: id,
      hoveredPoiLabel: label,
      hoverPosition: pos,
      hoveredNpcIndex: null,
    }),
    setLlmConfig: (config) => set((s) => ({ llmConfig: { ...s.llmConfig, ...config } })),
    setChatting: (isChatting: boolean) => set((s) => ({ 
      isChatting, 
      isTyping: isChatting ? s.isTyping : false,
      isThinking: isChatting ? s.isThinking : false,
      chatMessages: isChatting ? s.chatMessages : []
    })),
  })
);

// Keep instanceCount in sync whenever the active agent set changes
useTeamStore.subscribe((state, prevState) => {
  if (state.selectedAgentSetId !== prevState.selectedAgentSetId) {
    const system = getActiveAgentSet();
    useUiStore.getState().setInstanceCount(getAllAgents(system).length + 1);
  }
});
