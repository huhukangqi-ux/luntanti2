# 本地 API + 网页工作台

本目录用 Express 同时做两件事：

1. **静态网页**：托管仓库里的 `web/`（默认主页 `index.html` 为 Figma 界面，已接 `/api/chat` 与 Vault；长图导出等见 `index.legacy.html`）。
2. **OpenAI 兼容代理**：`POST /api/chat` 把根目录的 `skill.md` + `method.md` 写进系统提示，再转发到你配置的 LLM。

**密钥只放在本机 `server/.env` 里**，不要写进代码、不要发到聊天或 Git。

---

## 第一次使用（Windows / macOS / Linux 通用）

1. **安装依赖**（在 `server` 目录下）：

   ```bash
   cd server
   npm install
   ```

2. **配置环境变量**：把 `.env.example` 复制为 `.env`，用记事本或编辑器打开 `.env`，至少填写：

   | 变量 | 说明 |
   |------|------|
   | `LLM_API_KEY` | 你的 API Key（必填） |
   | `LLM_BASE_URL` | 兼容 OpenAI 的网关根地址，默认 `https://api.openai.com/v1`；用国内/中转服务时改成对方文档里的地址（通常以 `/v1` 结尾） |
   | `LLM_MODEL` | 模型名，如 `gpt-4o-mini` |
   | `PORT` | 端口，默认 `3847` |
   | `CORS_ORIGIN` | 可选。前端与 API **不同域**时填前端完整来源（如 `https://你的前端域名`），否则浏览器会拦截跨域请求 |

3. **启动**：

   ```bash
   npm start
   ```

4. **用浏览器打开**（必须走 `http://`；`file://` 无法请求 `/api/chat`）：

   - **主页（Figma + `/api/chat`）**：<http://127.0.0.1:3847/>  
   - **旧版工作台**（同 API，另含长图导出等）：<http://127.0.0.1:3847/index.legacy.html>  
   - 书签 **`/index-figma.html`** 会自动跳转到主页。

5. **在网页里**：上传/填写灵感 → 点 **开始创作** → 在「对话」区与模型多轮交互（可点 **确认** 等快捷按钮）。顶栏会显示 API 是否就绪。

---

## 部署到公网（简要）

- **推荐（同源）**：同一台机器或同一域名下同时托管 `web/` 静态文件与本 `server`（例如 Nginx 反代到 Node）。此时无需改前端，请求仍发往相对路径 `/api/chat`。
- **前后端分离（跨域）**：在 `web/index.html` 里、**加载 `app.js` 之前**增加  
  `<script>window.SHEMEI_API_BASE = "https://你的 API 域名";</script>`（无尾斜杠）。在 `server/.env` 设置 **`CORS_ORIGIN`** 为前端页面的完整来源（与浏览器地址栏协议+域名+端口一致），否则浏览器会拒绝读接口响应。

---

## 自检

- 浏览器访问：<http://127.0.0.1:3847/api/health>  
  应返回 JSON，其中 `apiKeyConfigured: true` 表示已读到 `LLM_API_KEY`。

---

## 接「自己的 API」时要注意什么

- 服务端请求体仍是：`{ "messages": [ { "role":"user"|"assistant", "content":"..." }, ... ] }`。
- 上游必须支持 **OpenAI 风格的** `POST {base}/chat/completions`，且返回 `choices[0].message.content` 文本。
- 若你的网关路径不是 `/v1`，把 `LLM_BASE_URL` 设成文档要求的根（代码里会自动去掉末尾 `/` 再拼 `/chat/completions`）。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| 页面提示无法连接 `/api/health` | 确认已 `npm start`，且地址是 `http://127.0.0.1:3847` 而不是 `file://` |
| 503 / 未配置密钥 | 检查 `server/.env` 里是否有 `LLM_API_KEY=` 且保存后**重启** `npm start` |
| 上游 401 / 403 | Key 或 `LLM_BASE_URL` 与服务商要求不一致，对照服务商文档修改 |

---

## 安全

- `.env` 已在仓库根目录 `.gitignore` 中忽略，**不要**手动取消忽略后提交。
- 若密钥曾泄露，请在服务商控制台**作废并换新**，只写入新的 `.env`。
