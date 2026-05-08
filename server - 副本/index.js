/**
 * 本地 API：挂载 skill.md + method.md 为系统提示，转发 OpenAI 兼容 POST /chat/completions
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const REPO_ROOT = path.join(__dirname, "..");
const WEB_DIR = path.join(REPO_ROOT, "web");

function readDoc(name) {
  const p = path.join(REPO_ROOT, name);
  try {
    return fs.readFileSync(p, "utf8");
  } catch (_e) {
    return "";
  }
}

function buildSystemPrompt() {
  const skill = readDoc("skill.md");
  const method = readDoc("method.md");
  const header = [
    "你在网页端模拟用户已通过指令 /xiaoshuo 触发了「社媒论坛体小说」创作流程。",
    "你必须严格、完整遵守下方附录中的 skill（编排闸门）与 method（各 Step 模板与质量标准）。",
    "多轮对话中：在用户确认前不要擅自进入 Step2/Step3；用户说「确认」或明确修改后再推进。",
    "输出语言与用户一致，默认简体中文。论坛体正文必须使用 method 规定的楼层标记格式（如 【1L｜ID】）。",
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

let cachedSystemPrompt = null;
function getSystemPrompt() {
  if (!cachedSystemPrompt) cachedSystemPrompt = buildSystemPrompt();
  return cachedSystemPrompt;
}

const app = express();

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

    const payload = {
      model,
      messages: [{ role: "system", content: getSystemPrompt() }, ...sanitized],
      temperature: 1,
      max_tokens: Number(process.env.LLM_MAX_TOKENS) || 8192,
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_e) {
      return res.status(502).json({
        error: "上游返回非 JSON",
        status: r.status,
        snippet: text.slice(0, 500),
      });
    }

    if (!r.ok) {
      return res.status(502).json({
        error: data.error?.message || data.message || `上游错误 HTTP ${r.status}`,
        detail: data,
      });
    }

    const choice = data.choices && data.choices[0];
    const msg = choice && choice.message;
    const content = msg && msg.content;
    if (typeof content !== "string") {
      return res.status(502).json({ error: "上游未返回文本 content", detail: data });
    }

    res.json({ message: { role: "assistant", content } });
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
