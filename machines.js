import { setup, createActor, assign } from "xstate";

const uid = () => Math.random().toString(36).slice(2, 10);

const appMachine = setup({
  types: { context: {}, events: {} },
}).createMachine({
  id: "app",
  initial: "running",
  context: {
    theme: "dark",
    agents: [],
    selectedAgentId: null,
    focusFilter: "all",
    panel: null,
    showApiSetup: true,
    showShell: false,
    shellTab: 'shell',
    wcStatus: 'unavailable',
    settings: { anthropicKey: "", openaiKey: "", defaultModel: "claude-sonnet-4-20250514" },
    models: [],
    modelsLoading: false,
    pendingApprovals: [],
    _lastApprovalDecisions: {},
  },
  states: {
    running: {
      on: {
        SET_THEME: { actions: assign({ theme: ({ event }) => event.theme }) },
        HYDRATE_AGENTS: { actions: assign({ agents: ({ event }) => event.agents, selectedAgentId: ({ context, event }) => event.agents.find(a => a.agentId === context.selectedAgentId) ? context.selectedAgentId : event.agents[0]?.agentId || null }) },
        SELECT_AGENT: { actions: assign({ selectedAgentId: ({ event }) => event.agentId, showApiSetup: false, agents: ({ context, event }) => context.agents.map(a => a.agentId === event.agentId ? { ...a, hasUnseenActivity: false } : a) }) },
        ADD_AGENT: { actions: assign({ agents: ({ context, event }) => [...context.agents, event.agent], selectedAgentId: ({ event }) => event.agent.agentId, showApiSetup: false }) },
        REMOVE_AGENT: { actions: assign({ agents: ({ context, event }) => context.agents.filter(a => a.agentId !== event.agentId), selectedAgentId: ({ context, event }) => context.selectedAgentId === event.agentId ? (context.agents.filter(a => a.agentId !== event.agentId)[0]?.agentId || null) : context.selectedAgentId }) },
        UPDATE_AGENT: { actions: assign({ agents: ({ context, event }) => context.agents.map(a => a.agentId === event.agentId ? { ...a, ...event.patch } : a) }) },
        SET_FILTER: { actions: assign({ focusFilter: ({ event }) => event.filter }) },
        SHOW_PANEL: { actions: assign({ panel: ({ event }) => event.panel }) },
        SHOW_API_SETUP: { actions: assign({ showApiSetup: ({ event }) => event.show }) },
        SHOW_SHELL: { actions: assign({ showShell: ({ event }) => event.show, showApiSetup: false }) },
        SET_SHELL_TAB: { actions: assign({ shellTab: ({ event }) => event.tab }) },
        SET_SETTINGS: { actions: assign({ settings: ({ event }) => event.settings }) },
        SET_MODELS: { actions: assign({ models: ({ event }) => event.models, modelsLoading: false }) },
        SET_MODELS_LOADING: { actions: assign({ modelsLoading: true }) },
        ADD_APPROVAL: { actions: assign({ pendingApprovals: ({ context, event }) => [...context.pendingApprovals, event.approval], agents: ({ context, event }) => context.agents.map(a => a.agentId === event.approval.agentId ? { ...a, awaitingUserInput: true } : a) }) },
        RESOLVE_APPROVAL: { actions: assign({ _lastApprovalDecisions: ({ context, event }) => ({ ...context._lastApprovalDecisions, [event.id]: event.decision }), pendingApprovals: ({ context, event }) => context.pendingApprovals.filter(a => a.id !== event.id), agents: ({ context, event }) => { const ap = context.pendingApprovals.find(a => a.id === event.id); if (!ap) return context.agents; const remaining = context.pendingApprovals.filter(a => a.id !== event.id && a.agentId === ap.agentId); return context.agents.map(a => a.agentId === ap.agentId ? { ...a, awaitingUserInput: remaining.length > 0 } : a); } }) },
        MARK_ACTIVITY: { actions: assign({ agents: ({ context, event }) => context.agents.map(a => a.agentId !== event.agentId ? a : { ...a, lastActivityAt: Date.now(), hasUnseenActivity: context.selectedAgentId !== event.agentId }) }) },
        SET_WC_STATUS: { actions: assign({ wcStatus: ({ event }) => event.status }) },
      }
    }
  }
});

function createAgentConfig(overrides) {
  return {
    agentId: overrides.agentId || uid(),
    name: overrides.name || "New Agent",
    avatarSeed: overrides.avatarSeed || uid(),
    model: overrides.model || "claude-sonnet-4-20250514",
    thinkingLevel: overrides.thinkingLevel || "high",
    sessionExecHost: overrides.sessionExecHost || "browser",
    sessionExecSecurity: overrides.sessionExecSecurity || "deny",
    sessionExecAsk: overrides.sessionExecAsk || "on-miss",
    toolCallingEnabled: overrides.toolCallingEnabled ?? true,
    showThinkingTraces: overrides.showThinkingTraces ?? true,
    intelligenceMode: overrides.intelligenceMode || "direct",
    acpAgent: overrides.acpAgent || "claude",
    acpSessionId: overrides.acpSessionId || null,
    status: "idle",
    awaitingUserInput: false,
    hasUnseenActivity: false,
    outputLines: [],
    streamText: null,
    thinkingTrace: null,
    lastResult: null,
    lastActivityAt: null,
    draft: "",
    sessionKey: uid(),
    toolAllowlist: [],
    ...overrides,
  };
}

function getSelectedAgent(ctx) { return ctx.agents.find(a => a.agentId === ctx.selectedAgentId) || null; }

function getFilteredAgents(ctx) {
  const pri = { running: 0, idle: 1, error: 2 };
  let list = ctx.agents;
  if (ctx.focusFilter === "running") list = list.filter(a => a.status === "running");
  else if (ctx.focusFilter === "approvals") list = list.filter(a => a.awaitingUserInput);
  return [...list].sort((a, b) => {
    const sd = (pri[a.status] ?? 1) - (pri[b.status] ?? 1);
    if (sd !== 0) return sd;
    return (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
  });
}

export { appMachine, createAgentConfig, getSelectedAgent, getFilteredAgents, uid };
