/**
 * 本地 API：挂载 skill.md + method.md 为系统提示，转发 OpenAI 兼容 POST /chat/completions
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const REPO_ROOT = path.join(__dirname, "..");
const WEB_DIR = path.join(REPO_ROOT, "web");
const LLM_REQUEST_TIMEOUT_MS = Number(process.env.LLM_REQUEST_TIMEOUT_MS) || 300000;

function nowMs() {
  return Date.now();
}

function elapsed(start) {
  return `${nowMs() - start}ms`;
}

function readDoc(name) {
  const p = path.join(REPO_ROOT, name);
  try {
    return fs.readFileSync(p, "utf8");
  } catch (_e) {
    return "";
  }
}

function pickMethodSection(method, startHeading, endHeading) {
  const start = method.indexOf(startHeading);
  if (start < 0) return "";
  const end = endHeading ? method.indexOf(endHeading, start + startHeading.length) : -1;
  return (end > start ? method.slice(start, end) : method.slice(start)).trim();
}

function buildCompactSkill(skill) {
  const keep = [];
  const trigger = pickMethodSection(skill, "## 触发条件", "## 核心原则");
  const principles = pickMethodSection(skill, "## 核心原则", "## 执行流程（对齐 PRD：先读后写）");
  const flow = pickMethodSection(skill, "## 执行流程（对齐 PRD：先读后写）", "## 自检清单（对齐 PRD 附录 + method）");
  if (trigger) keep.push(trigger);
  if (principles) keep.push(principles);
  if (flow) keep.push(flow);
  return keep.join("\n\n");
}

function buildMethodByStage(method, stage) {
  const tone = pickMethodSection(method, "## 与用户沟通时的用语习惯", "");
  let core = "";
  if (stage === "step1") {
    core = pickMethodSection(method, "## Step1：灵感补全", "## Step2：论坛体故事发展大纲");
  } else if (stage === "step2") {
    core = pickMethodSection(method, "## Step2：论坛体故事发展大纲", "## Step3：论坛体正文（约 50～80 楼）");
  } else if (stage === "step3") {
    core = pickMethodSection(method, "## Step3：论坛体正文（约 50～80 楼）", "## Step4：人性化去痕（Humanizer / 减少 AI 感）");
  } else if (stage === "step4") {
    core = pickMethodSection(method, "## Step4：人性化去痕（Humanizer / 减少 AI 感）", "## 与用户沟通时的用语习惯");
  } else {
    core = [
      pickMethodSection(method, "## Step1：灵感补全", "## Step2：论坛体故事发展大纲"),
      pickMethodSection(method, "## Step2：论坛体故事发展大纲", "## Step3：论坛体正文（约 50～80 楼）"),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [core, tone].filter(Boolean).join("\n\n");
}

function buildSystemPrompt(stage) {
  const skill = buildCompactSkill(readDoc("skill.md"));
  const method = buildMethodByStage(readDoc("method.md"), stage);
  const header = [
    "你在网页端模拟用户已通过指令 /xiaoshuo 触发了「社媒论坛体小说」创作流程。",
    "你必须严格遵守下方附录中的 skill（编排闸门）与当前阶段对应的 method 片段。",
    "多轮对话中：在用户确认前不要擅自进入 Step2/Step3；用户说「确认」或明确修改后再推进。",
    "输出语言与用户一致，默认简体中文。论坛体正文必须使用 method 规定的楼层标记格式（如 【1L｜ID】）。",
    stage === "step3" || stage === "step4"
      ? "当前是长输出阶段：优先保证楼层推进、回复关系和声纹准确；若内容过长，可自然分段，并明确提示用户回复“继续”。"
      : "当前优先保证交互闸门准确，先确认再推进，不要抢跑到后续阶段。",
    "",
    "【网页首轮硬规则】当用户在本轮 /xiaoshuo 消息里「—— 素材（来自上传文件）——」之后附带了**成段可读**的灵感正文（明显多于几个字）时：你必须**在同一条助手回复中**直接按 method「Step1：灵感补全」输出完整 Markdown（须含「## 灵感补全稿」及模板中的各小节），并按 method 文末句式邀请用户「确认」或修改；**禁止**仅用 skill「阶段 A」泛泛追问却不给出灵感补全稿。仅当素材几乎为空、乱码或完全无法理解时，才允许先提**至多 2 个**澄清问题，并在同条回复中仍尽量给出可编辑的 Step1 草案。",
    "",
    "**网页首轮（含上传素材）**：若用户首条消息含 `/xiaoshuo` 且「素材」段落中有**成段可读**的灵感（通常远多于几个字），必须**直接**按 method「Step1：灵感补全」输出完整「灵感补全稿」（含 method 模板中的 Markdown 小节），文末用中文明确邀请用户回复「确认」或指出修改点；**不要**仅在 skill「阶段 A」反复追问而把 Step1 推后。仅在素材几乎为空、无法推断题材与冲突时，最多追问 **1 条**关键问题，随后仍须给出完整 Step1 稿。",
    "",
    "—— 附录 A：skill.md ——",
    skill || "（缺失 skill.md）",
    "",
    "—— 附录 B：method.md ——",
    method || "（缺失 method.md）",
  ].join("\n");
  return header;
}

const promptCache = new Map();
function getSystemPrompt(stage) {
  const key = stage || "unknown";
  if (!promptCache.has(key)) promptCache.set(key, buildSystemPrompt(key));
  return promptCache.get(key);
}

function inferCurrentStage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = String(messages[i] && messages[i].content ? messages[i].content : "");
    if (/【\s*\d+L[｜|]/.test(text)) return "step3";
    if (/灵感补全稿|##\s*灵感补全|Step1|灵感/.test(text)) return "step1";
    if (/论坛体发展大纲|分段节奏|Step2|大纲/.test(text)) return "step2";
  }
  return "unknown";
}

function getLastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === "user") return String(msg.content || "");
  }
  return "";
}

function inferTargetStage(messages) {
  const lastUser = getLastUserText(messages);
  if (/Step\s*1|step\s*1|灵感补全|系统侧已注入|method「Step1|——\s*素材/.test(lastUser)) {
    return "step1";
  }
  if (/Step\s*4|step\s*4|人性化|去痕|AI\s*感|润色/.test(lastUser)) return "step4";
  if (/Step\s*3|step\s*3|正文|论坛体正文|进入\s*3|进\s*3|继续\s*\d*[\s-]*(楼|L)?/.test(lastUser)) {
    return "step3";
  }
  if (/Step\s*2|step\s*2|大纲|分段/.test(lastUser)) return "step2";

  const current = inferCurrentStage(messages);
  if (current === "step2" && /确认|可以|继续|开始写|进入/.test(lastUser)) return "step3";
  if (current === "step3" && /确认|继续|优化|润色/.test(lastUser)) return "step4";
  return current;
}

function buildChunkInstruction(stage) {
  if (stage === "step3") {
    return [
      "请主动采用分段输出，不要一次性写完整长帖。",
      "这一次只输出当前论坛体正文的一段，控制在 20 到 25 楼。",
      "必须从当前应写的起始楼层连续编号，保留【xL｜ID】格式与回复楼层标注。",
      "文末单独补一句：如果需要下一段，请直接回复“继续”。",
    ].join("");
  }
  if (stage === "step4") {
    return [
      "请主动采用分段输出，不要一次性润色完整长帖。",
      "这一次只优化 10 到 15 楼，保持楼层号、ID、剧情事实与回复关系不变。",
      "文末单独补一句：如果需要继续优化下一段，请直接回复“继续”。",
    ].join("");
  }
  return "";
}

function buildChunkRetryHint(messages, stage) {
  if (stage === "step2") {
    return [
      "上一次请求因内容过长或上游响应过慢而超时。",
      "请保持当前任务不变，但压缩输出长度。",
      "如果你正在写大纲，只输出最关键的总览和前两到三个分段，结尾提示我回复“继续”获取下一段。",
    ].join("");
  }
  return [
    "上一次请求因内容过长或上游响应过慢而超时。",
    "请保持当前任务不变，但优先输出最关键、最短的一段结果，必要时主动分段，并提示我回复“继续”。",
  ].join("");
}

function compactMessagesForStage(messages, stage) {
  if (stage !== "step3" && stage !== "step4") return messages;
  const firstUser = messages.find((m) => m.role === "user");
  const recent = messages.slice(-8);
  const merged = [];
  if (firstUser) merged.push(firstUser);
  for (const msg of recent) {
    if (!firstUser || msg !== firstUser) merged.push(msg);
  }
  return merged;
}

function getMaxTokensForStage(stage) {
  const configured = Number(process.env.LLM_MAX_TOKENS);
  if (configured > 0) return configured;
  if (stage === "step1") return 2400;
  if (stage === "step2") return 3200;
  if (stage === "step3") return 6000;
  if (stage === "step4") return 5000;
  return 3200;
}

async function requestChatCompletion(url, key, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function streamChatCompletion(url, key, payload, res, trace) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
  let heartbeat = null;
  let response;
  const started = nowMs();
  let firstTokenAt = 0;
  let tokenChunks = 0;

  try {
    console.log(
      `[api/chat ${trace}] upstream:start model=${payload.model} messages=${payload.messages.length} max_tokens=${payload.max_tokens}`
    );
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal,
    });
    console.log(
      `[api/chat ${trace}] upstream:headers status=${response.status} after=${elapsed(started)}`
    );

    if (!response.ok) {
      const text = await response.text();
      let detail = {};
      try {
        detail = JSON.parse(text);
      } catch (_e) {
        detail = { snippet: text.slice(0, 500) };
      }
      return res.status(502).json({
        error: detail.error?.message || detail.message || `上游错误 HTTP ${response.status}`,
        detail,
      });
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const sendSse = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const sendHeartbeat = () => {
      res.write(`: keepalive ${Date.now()} ${".".repeat(1024)}\n\n`);
    };
    sendHeartbeat();
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) {
        sendHeartbeat();
      }
    }, 10000);

    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let json;
        try {
          json = JSON.parse(data);
        } catch (_e) {
          continue;
        }

        const choice = json.choices && json.choices[0];
        const delta = choice && choice.delta;
        const content = delta && delta.content;
        if (typeof content === "string" && content) {
          if (!firstTokenAt) {
            firstTokenAt = nowMs();
            console.log(`[api/chat ${trace}] upstream:first-token after=${elapsed(started)}`);
          }
          tokenChunks += 1;
          sendSse("delta", { content });
        }
      }
    }

    const tail = decoder.decode();
    if (tail) {
      buffer += tail;
    }

    console.log(
      `[api/chat ${trace}] upstream:done chunks=${tokenChunks} total=${elapsed(started)} first_token_ms=${
        firstTokenAt ? firstTokenAt - started : "none"
      }`
    );
    sendSse("done", {});
    return res.end();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    clearTimeout(timer);
  }
}

function parseUpstreamJson(response, text, res) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_e) {
    res.status(502).json({
      error: "上游返回非 JSON",
      status: response.status,
      snippet: text.slice(0, 500),
    });
    return null;
  }

  if (!response.ok) {
    res.status(502).json({
      error: data.error?.message || data.message || `上游错误 HTTP ${response.status}`,
      detail: data,
    });
    return null;
  }

  const choice = data.choices && data.choices[0];
  const msg = choice && choice.message;
  const content = msg && msg.content;
  if (typeof content !== "string") {
    res.status(502).json({ error: "上游未返回文本 content", detail: data });
    return null;
  }

  return content;
}

const app = express();

app.use((req, res, next) => {
  const id = Math.random().toString(36).slice(2, 8);
  const started = nowMs();
  req.traceId = id;
  console.log(`[http ${id}] -> ${req.method} ${req.originalUrl}`);
  res.on("finish", () => {
    console.log(`[http ${id}] <- ${res.statusCode} ${req.method} ${req.originalUrl} ${elapsed(started)}`);
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      console.warn(`[http ${id}] xx client-closed ${req.method} ${req.originalUrl} ${elapsed(started)}`);
    }
  });
  next();
});

const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });
}

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    apiKeyConfigured: Boolean(process.env.LLM_API_KEY),
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
  });
});

app.post("/api/chat", async (req, res) => {
  const trace = req.traceId || Math.random().toString(36).slice(2, 8);
  const started = nowMs();
  try {
    const key = process.env.LLM_API_KEY;
    if (!key) {
      return res.status(503).json({
        error: "LLM_API_KEY 未配置。复制 server/.env.example 为 server/.env 并填写密钥。",
      });
    }

    const raw = req.body.messages;
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ error: "body.messages 必须为非空数组" });
    }

    const sanitized = [];
    for (const m of raw) {
      if (!m || typeof m !== "object") continue;
      const role = m.role;
      const content = m.content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        continue;
      }
      if (content.trim() === "") continue;
      sanitized.push({ role, content });
    }

    if (sanitized.length === 0) {
      return res.status(400).json({ error: "至少需要一条有效的 user / assistant 消息" });
    }

    const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const url = `${base}/chat/completions`;
    const model = process.env.LLM_MODEL || "gpt-4o-mini";

    const currentStage = inferTargetStage(sanitized);
    const stageMessages = compactMessagesForStage(sanitized, currentStage);
    const chunkInstruction = buildChunkInstruction(currentStage);
    const baseMessages = [
      { role: "system", content: getSystemPrompt(currentStage) },
      ...stageMessages,
      ...(chunkInstruction ? [{ role: "user", content: chunkInstruction }] : []),
    ];
    const payload = {
      model,
      messages: baseMessages,
      temperature: Number(process.env.LLM_TEMPERATURE) || 0.85,
      max_tokens: getMaxTokensForStage(currentStage),
    };
    console.log(
      `[api/chat ${trace}] prepared stage=${currentStage} raw_messages=${raw.length} sanitized=${sanitized.length} prompt_messages=${baseMessages.length}`
    );

    try {
      return await streamChatCompletion(url, key, payload, res, trace);
    } catch (e) {
      console.warn(`[api/chat ${trace}] error after=${elapsed(started)} name=${e && e.name} message=${e && e.message}`);
      if (e && e.name === "AbortError") {
        if (res.headersSent) {
          return res.end(
            "\n\n请求已等待 5 分钟后中断。如果内容还没完整，请重新发送“继续”再试一次。"
          );
        }
        return res.status(504).json({
          error:
            "请求超时：系统已等待 5 分钟，但上游仍未及时返回。你可以重新试一次；若仍较慢，建议把正文按 20 到 25 楼一段继续生成。",
        });
      }
      throw e;
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.use(express.static(WEB_DIR));

const PORT = Number(process.env.PORT) || 3847;
app.listen(PORT, () => {
  var host = "127.0.0.1";
  var base = `http://${host}:${PORT}`;
  console.log("社媒小说 — API + 静态站 已启动");
  console.log(`  主页（Figma 界面）:     ${base}/`);
  console.log(`  旧版工作台:             ${base}/index.legacy.html`);
  console.log(`  健康检查:               ${base}/api/health`);
  console.log(`  LLM: ${process.env.LLM_BASE_URL || "https://api.openai.com/v1"}  model=${process.env.LLM_MODEL || "gpt-4o-mini"}`);
  console.log(`  API Key: ${process.env.LLM_API_KEY ? "已配置" : "未配置（对话不可用，请先写 server/.env）"}`);
});
