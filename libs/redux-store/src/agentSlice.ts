import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { CustomAgent, AgentToolDef } from '@prism/shared-types';

export interface AgentState {
  agents: CustomAgent[];
  activeAgentId: string | null;
  isLoading: boolean;
  editingAgent: CustomAgent | null;
}

const initialState: AgentState = {
  agents: [],
  activeAgentId: null,
  isLoading: false,
  editingAgent: null,
};

export const agentSlice = createSlice({
  name: 'agents',
  initialState,
  reducers: {
    setAgents: (state, action: PayloadAction<CustomAgent[]>) => {
      state.agents = action.payload;
    },
    addAgent: (state, action: PayloadAction<CustomAgent>) => {
      state.agents.unshift(action.payload);
    },
    updateAgent: (
      state,
      action: PayloadAction<{ id: string; updates: Partial<CustomAgent> }>,
    ) => {
      const idx = state.agents.findIndex((a) => a.id === action.payload.id);
      if (idx !== -1) {
        state.agents[idx] = { ...state.agents[idx], ...action.payload.updates };
      }
    },
    removeAgent: (state, action: PayloadAction<string>) => {
      state.agents = state.agents.filter((a) => a.id !== action.payload);
      if (state.activeAgentId === action.payload) {
        state.activeAgentId = null;
      }
    },
    setActiveAgent: (state, action: PayloadAction<string | null>) => {
      state.activeAgentId = action.payload;
    },
    setAgentsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setEditingAgent: (state, action: PayloadAction<CustomAgent | null>) => {
      state.editingAgent = action.payload;
    },
    addToolToEditing: (state, action: PayloadAction<AgentToolDef>) => {
      if (state.editingAgent) {
        state.editingAgent.tools.push(action.payload);
      }
    },
    updateToolInEditing: (
      state,
      action: PayloadAction<{ index: number; updates: Partial<AgentToolDef> }>,
    ) => {
      if (
        state.editingAgent &&
        state.editingAgent.tools[action.payload.index]
      ) {
        state.editingAgent.tools[action.payload.index] = {
          ...state.editingAgent.tools[action.payload.index],
          ...action.payload.updates,
        };
      }
    },
    removeToolFromEditing: (state, action: PayloadAction<number>) => {
      if (state.editingAgent) {
        state.editingAgent.tools.splice(action.payload, 1);
      }
    },
  },
});

export const {
  setAgents,
  addAgent,
  updateAgent,
  removeAgent,
  setActiveAgent,
  setAgentsLoading,
  setEditingAgent,
  addToolToEditing,
  updateToolInEditing,
  removeToolFromEditing,
} = agentSlice.actions;

export default agentSlice.reducer;
