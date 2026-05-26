
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AgenticSystem, AGENTIC_SETS, DEFAULT_AGENTIC_SET_ID, getAgentSet } from '../../data/agents';
import { DEFAULT_MODELS } from '../../core/llm/constants';

export type AgentSet = AgenticSystem;

interface TeamState {
  selectedAgentSetId: string;
  customSystems: AgenticSystem[];
  hiddenSystemIds: string[];

  saveCustomSystem: (system: AgenticSystem) => void;
  deleteCustomSystem: (id: string) => void;
  updateActiveSystem: (changes: Partial<AgenticSystem>) => void;
  updateSystem: (id: string, changes: Partial<AgenticSystem>) => void;
  setActiveTeam: (id: string) => void;
  hideSystem: (id: string) => void;
  unhideAllSystems: () => void;
}

export const useTeamStore = create<TeamState>()(
  persist(
    (set) => ({
      selectedAgentSetId: DEFAULT_AGENTIC_SET_ID,
      customSystems: [],
      hiddenSystemIds: [],

      saveCustomSystem: (system) =>
        set((s) => ({
          customSystems: s.customSystems.some((cs) => cs.id === system.id)
            ? s.customSystems.map((cs) => (cs.id === system.id ? sanitizeSystem(system) : cs))
            : [...s.customSystems, sanitizeSystem(system)],
        })),

      deleteCustomSystem: (id) =>
        set((s) => ({
          customSystems: s.customSystems.filter((cs) => cs.id !== id),
          selectedAgentSetId: s.selectedAgentSetId === id ? DEFAULT_AGENTIC_SET_ID : s.selectedAgentSetId,
        })),

      hideSystem: (id) =>
        set((s) => ({
          hiddenSystemIds: s.hiddenSystemIds.includes(id) ? s.hiddenSystemIds : [...s.hiddenSystemIds, id],
          customSystems: s.customSystems.filter((cs) => cs.id !== id),
          selectedAgentSetId: s.selectedAgentSetId === id ? DEFAULT_AGENTIC_SET_ID : s.selectedAgentSetId,
        })),

      unhideAllSystems: () => set({ hiddenSystemIds: [] }),

      updateActiveSystem: (changes) => set((s) => {
        const currentSystem = getAgentSet(s.selectedAgentSetId, s.customSystems);
        const updatedSystem = sanitizeSystem({ ...currentSystem, ...changes });
        return {
          customSystems: s.customSystems.some((cs) => cs.id === updatedSystem.id)
            ? s.customSystems.map((cs) => (cs.id === updatedSystem.id ? updatedSystem : cs))
            : [...s.customSystems, updatedSystem],
        };
      }),

      updateSystem: (id, changes) => set((s) => {
        const system = getAgentSet(id, s.customSystems);
        const updatedSystem = sanitizeSystem({ ...system, ...changes });
        return {
          customSystems: s.customSystems.some((cs) => cs.id === id)
            ? s.customSystems.map((cs) => (cs.id === id ? updatedSystem : cs))
            : [...s.customSystems, updatedSystem],
        };
      }),

      setActiveTeam: (id) => set({
        selectedAgentSetId: id,
      }),
    }),
    {
      name: 'team-storage',
      storage: createJSONStorage(() => localStorage),
      version: 3,
      migrate: (persisted, _version) => {
        const state = (persisted as any) || {};
        const sanitizedCustomSystems = Array.isArray(state.customSystems)
          ? state.customSystems.map((s: AgenticSystem) => sanitizeSystem(s))
          : [];

        const allIds = new Set<string>([
          ...AGENTIC_SETS.map((s) => s.id),
          ...sanitizedCustomSystems.map((s: AgenticSystem) => s.id),
        ]);

        const selectedAgentSetId = allIds.has(state.selectedAgentSetId)
          ? state.selectedAgentSetId
          : DEFAULT_AGENTIC_SET_ID;

        return {
          ...state,
          selectedAgentSetId,
          customSystems: sanitizedCustomSystems,
          hiddenSystemIds: Array.isArray(state.hiddenSystemIds) ? state.hiddenSystemIds : [],
        } as TeamState;
      },
    }
  )
);

function sanitizeSystem(system: AgenticSystem): AgenticSystem {
  if (!system) return system;
  if (system.outputType !== 'text') {
    return {
      ...system,
      outputType: 'text',
      outputModel: DEFAULT_MODELS.text,
      outputAutoApprove: true,
    };
  }
  if (!system.outputModel) {
    return { ...system, outputModel: DEFAULT_MODELS.text };
  }
  return system;
}

/** Returns the currently active AgentSet. Safe to call from service/non-React contexts. */
export function getActiveAgentSet(): AgentSet {
  const { selectedAgentSetId, customSystems } = useTeamStore.getState();
  return getAgentSet(selectedAgentSetId, customSystems);
}

/** React hook for accessing the currently active team. */
export function useActiveTeam(): AgentSet {
  const { selectedAgentSetId, customSystems } = useTeamStore();
  return getAgentSet(selectedAgentSetId, customSystems);
}
