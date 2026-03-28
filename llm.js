async function* streamAnthropic(apiKey, messages, opts = {}) {
  const body = {
    model: opts.model || "claude-sonnet-4-20250514",
    max_tokens: opts.maxTokens || 8192,
    stream: true,
    messages,
  };
  if (opts.system) body.system = opts.system;
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.thinking) body.thinking = { type: "enabled", budget_tokens: opts.thinkingBudget || 4096 };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    const err = await resp.text();
    yield { type: "error", status: resp.status, message: err };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try { yield JSON.parse(data); } catch {}
      }
    }
  }
}

function mapMessagesForOpenAI(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content === "string") { out.push({ role: "user", content: m.content }); continue; }
      const toolResults = m.content.filter(b => b.type === "tool_result");
      if (toolResults.length) {
        for (const tr of toolResults)
          out.push({ role: "tool", tool_call_id: tr.tool_use_id, content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content) });
        continue;
      }
      out.push({ role: "user", content: m.content.filter(b => b.type === "text").map(b => b.text).join("") });
    } else if (m.role === "assistant") {
      if (typeof m.content === "string") { out.push({ role: "assistant", content: m.content }); continue; }
      const toolUses = m.content.filter(b => b.type === "tool_use");
      if (toolUses.length) {
        const text = m.content.filter(b => b.type === "text").map(b => b.text).join("");
        out.push({ role: "assistant", content: text || null, tool_calls: toolUses.map(tu => ({ id: tu.id, type: "function", function: { name: tu.name, arguments: JSON.stringify(tu.input) } })) });
        continue;
      }
      out.push({ role: "assistant", content: m.content.filter(b => b.type === "text").map(b => b.text).join("") });
    }
  }
  return out;
}

async function* streamOpenAI(apiKey, messages, opts = {}) {
  const body = {
    model: opts.model || "gpt-4o",
    stream: true,
    messages: mapMessagesForOpenAI(messages),
  };
  if (opts.system) body.messages.unshift({ role: "system", content: opts.system });
  if (opts.tools?.length) body.tools = opts.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!resp.ok) {
    yield { type: "error", status: resp.status, message: await resp.text() };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const state = { toolIdx: 1 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta.content } };
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) { yield { type: "content_block_start", index: state.toolIdx, content_block: { type: "tool_use", id: tc.id || ("tu_" + state.toolIdx), name: tc.function.name, input: {} } }; }
            if (tc.function?.arguments) yield { type: "content_block_delta", index: state.toolIdx, delta: { type: "input_json_delta", partial_json: tc.function.arguments } };
          }
        }
      } catch {}
    }
  }
}

async function fetchModels(anthropicKey, openaiKey) {
  const models = [];
  if (anthropicKey) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
      });
      if (r.ok) {
        const d = await r.json();
        (d.data || []).forEach(m => models.push({ id: m.id, name: m.display_name || m.id, provider: "anthropic" }));
      }
    } catch {}
  }
  if (openaiKey) {
    try {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { "Authorization": "Bearer " + openaiKey } });
      if (r.ok) {
        const d = await r.json();
        (d.data || []).filter(m => m.id.includes("gpt") || m.id.includes("o1") || m.id.includes("o3")).forEach(m => models.push({ id: m.id, name: m.id, provider: "openai" }));
      }
    } catch {}
  }
  if (models.length === 0) {
    ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-20250506"].forEach(id => models.push({ id, name: id, provider: "anthropic" }));
  }
  return models;
}

function isAnthropicModel(model) { return model.startsWith("claude"); }

export { streamAnthropic, streamOpenAI, fetchModels, isAnthropicModel };
