import { streamAnthropic, streamOpenAI, isAnthropicModel } from "./llm.js";
import { getToolDefs, executeTool, needsApproval } from "./tools.js";
import { getAgentFile, getHistory, saveHistory } from "./db.js";
import { uid } from "./machines.js";

const MAX_TOOL_LOOPS = 10;
const activeControllers = new Map();

async function runAgent(actor, agentId, userMessage) {
  const ctx = actor.getSnapshot().context;
  const agent = ctx.agents.find(a => a.agentId === agentId);
  if (!agent) return;

  const controller = new AbortController();
  activeControllers.set(agentId, controller);

  actor.send({ type: "UPDATE_AGENT", agentId, patch: { status: "running", streamText: null, thinkingTrace: null } });

  let history = await getHistory(agentId);
  if (userMessage) {
    history.push({ role: "user", content: userMessage });
    actor.send({ type: "UPDATE_AGENT", agentId, patch: { outputLines: [...agent.outputLines, "user: " + userMessage] } });
  }

  const claudeMd = await getAgentFile(agentId, "CLAUDE.md") || "";
  const personality = await getAgentFile(agentId, "personality.md") || "";
  const systemPrompt = [personality, claudeMd, "You are " + agent.name + ". You have browser-based tools available."].filter(Boolean).join("\n\n");
  const tools = agent.toolCallingEnabled ? getToolDefs() : [];
  const apiKey = isAnthropicModel(agent.model) ? ctx.settings.anthropicKey : ctx.settings.openaiKey;

  if (!apiKey) {
    actor.send({ type: "UPDATE_AGENT", agentId, patch: { status: "error", outputLines: [...agent.outputLines, "assistant: Error - No API key configured. Go to settings to add your key."] } });
    await saveHistory(agentId, history);
    return;
  }

  let loops = 0;
  while (loops < MAX_TOOL_LOOPS) {
    loops++;
    let fullText = "", thinkingText = "", toolUses = [];
    const streamFn = isAnthropicModel(agent.model) ? streamAnthropic : streamOpenAI;
    const updatedAgent = () => actor.getSnapshot().context.agents.find(a => a.agentId === agentId);

    try {
      for await (const evt of streamFn(apiKey, history, { model: agent.model, system: systemPrompt, tools: tools.length ? tools : undefined, thinking: agent.showThinkingTraces, signal: controller.signal })) {
        if (evt.type === "error") {
          actor.send({ type: "UPDATE_AGENT", agentId, patch: { status: "error", streamText: null, outputLines: [...(updatedAgent()?.outputLines || []), "assistant: API Error " + evt.status + ": " + evt.message.slice(0, 200)] } });
          await saveHistory(agentId, history);
          activeControllers.delete(agentId);
          return;
        }
        if (evt.type === "content_block_delta") {
          if (evt.delta?.type === "text_delta") { fullText += evt.delta.text; actor.send({ type: "UPDATE_AGENT", agentId, patch: { streamText: fullText } }); }
          if (evt.delta?.type === "thinking_delta") { thinkingText += evt.delta.thinking; actor.send({ type: "UPDATE_AGENT", agentId, patch: { thinkingTrace: thinkingText } }); }
          if (evt.delta?.type === "input_json_delta" && toolUses.length) { const last = toolUses[toolUses.length - 1]; last._inputJson = (last._inputJson || "") + evt.delta.partial_json; }
        }
        if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
          toolUses.push({ id: evt.content_block.id, name: evt.content_block.name, _inputJson: "" });
        }
      }
    } catch (e) {
      if (e.name === "AbortError") { actor.send({ type: "UPDATE_AGENT", agentId, patch: { status: "idle", streamText: null, thinkingTrace: null } }); activeControllers.delete(agentId); return; }
      actor.send({ type: "UPDATE_AGENT", agentId, patch: { status: "error", streamText: null } });
      activeControllers.delete(agentId);
      return;
    }

    if (toolUses.length > 0) {
      const content = [];
      if (fullText) content.push({ type: "text", text: fullText });
      for (const tu of toolUses) {
        let input = {}; try { input = JSON.parse(tu._inputJson || "{}"); } catch {}
        content.push({ type: "tool_use", id: tu.id, name: tu.name, input });
      }
      history.push({ role: "assistant", content });

      const toolResults = [];
      for (const tu of toolUses) {
        let input = {}; try { input = JSON.parse(tu._inputJson || "{}"); } catch {}
        const ag = updatedAgent();
        if (ag && needsApproval(ag, tu.name)) {
          const approvalId = uid();
          actor.send({ type: "ADD_APPROVAL", approval: { id: approvalId, agentId, command: tu.name + "(" + JSON.stringify(input).slice(0, 100) + ")", toolName: tu.name, toolInput: input, toolUseId: tu.id, cwd: null, host: null, security: ag.sessionExecSecurity, createdAtMs: Date.now(), resolving: false, error: null } });
          const decision = await waitForApproval(actor, approvalId);
          if (decision === "deny") { toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "Denied by user" }); continue; }
          if (decision === "allow-always") actor.send({ type: "UPDATE_AGENT", agentId, patch: { toolAllowlist: [...(ag.toolAllowlist || []), tu.name] } });
        }
        const lines = updatedAgent()?.outputLines || [];
        actor.send({ type: "UPDATE_AGENT", agentId, patch: { outputLines: [...lines, "tool: " + tu.name + " → executing..."], streamText: null } });
        const result = await executeTool(agentId, tu.name, input);
        actor.send({ type: "UPDATE_AGENT", agentId, patch: { outputLines: [...(updatedAgent()?.outputLines || []).slice(0, -1), "tool: " + tu.name + " → " + result.slice(0, 200)] } });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
      }
      history.push({ role: "user", content: toolResults });
      actor.send({ type: "UPDATE_AGENT", agentId, patch: { streamText: null, thinkingTrace: null } });
      continue;
    }

    if (fullText) {
      history.push({ role: "assistant", content: fullText });
      const ag = updatedAgent();
      actor.send({ type: "UPDATE_AGENT", agentId, patch: { status: "idle", streamText: null, thinkingTrace: null, lastResult: fullText, lastActivityAt: Date.now(), outputLines: [...(ag?.outputLines || []), "assistant: " + fullText] } });
      actor.send({ type: "MARK_ACTIVITY", agentId });
    } else {
      actor.send({ type: "UPDATE_AGENT", agentId, patch: { status: "idle", streamText: null, thinkingTrace: null } });
    }
    break;
  }

  await saveHistory(agentId, history);
  activeControllers.delete(agentId);
}

function waitForApproval(actor, approvalId) {
  return new Promise(resolve => {
    const unsub = actor.subscribe(snap => {
      if (!snap.context.pendingApprovals.find(a => a.id === approvalId)) {
        unsub.unsubscribe();
        resolve(snap.context._lastApprovalDecision || "allow-once");
      }
    });
  });
}

function abortAgent(agentId) {
  const c = activeControllers.get(agentId);
  if (c) c.abort();
}

export { runAgent, abortAgent };
