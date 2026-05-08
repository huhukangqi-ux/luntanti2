# 前端信息架构（与实现对齐）

**用途**：描述 **`web/index.html`**（默认 **Figma 界面**：Forge / Vault / Nexus 三屏切换）与 **`web/index.legacy.html`**（旧版含 `/api/chat`、长图导出等）；改页面时请同步本文。

**关联**：论坛体 Skill `/xiaoshuo`，skill / method 在仓库 Markdown 与本机 Cursor Agent 中使用。

---

## 1. 技术栈

| 项目 | 说明 |
|------|------|
| 入口 | `web/index.html`（`figma-pixel.css` / `figma-pixel.js`）；旧版工作台 `web/index.legacy.html`（`styles.css`、`app.js`、`thread-to-image.js`，`html2canvas` 需 CDN） |
| 脚本 | 主页：`figma-pixel.js`；旧版：`app.js`、`thread-to-image.js` |
| 样式 | 主页：`figma-pixel.css`；旧版：`styles.css` |

`thread-to-image.html` **重定向** 到 `index.legacy.html#compose-export-image`。`index-figma.html` 重定向到 `/`。

---

## 2. 导航（参考稿：AI 工作台风）

**主页**：顶栏 **论坛小说工作室**｜pill：**The Forge**／**The Vault**／**The Nexus**（纯前端切换）。**旧版**顶栏另有「长图」等 hash 路由，见下节。

- PRD：`web/prd.html` 仅文档页，顶端样式与主页对齐。

---

## 3. 路由

**`index.html`（主页）**：无 hash 路由，三屏由 `figma-pixel.js` 切换。

**`index.legacy.html`（旧版）** hash：

| Hash | 行为 |
|------|------|
| `#compose` | 创作：上传灵感 → **对话**（`/api/chat` + skill/method）→ 预览 → 论坛体长图 |
| `#compose-export-image` | 滚动到「论坛体 · 导出长图」 |
| `#library` / `#explore` | Vault / Nexus |
| 其它无效片段 | 归一为 `#compose` |

---

## 4. 旧版创作页（`index.legacy.html` · The Forge）

### 4.1 上传灵感 Query

- **交互**：拖拽或点击上传区选择 **.txt / .md**（最大 **2MB**），仅写入本地内存 `composeRawText`，不自动联网。
- **开始创作**：右侧主按钮 → 清空会话 → 以 `buildPrompt()` 作为**首条 user** 调用 **`POST /api/chat`**；服务端将根目录 `skill.md` + `method.md` 注入系统提示，多轮闸门与 Cursor 内 Agent 一致。
- **对话区**：展示 user/助手气泡；输入框续聊；**再次点「开始创作」**会清空会话并重新发首轮。
- **运行条件**：须用 **`server` 启动后的 http 地址** 打开站点（同域 `/api`）；配置 `LLM_API_KEY`。`file://` 仅可上传与预览，不可对话。
- **复制 / 保存**：仍可将预览区「仅含指令与素材」的包复制到 Cursor，或保存到 Vault。

### 4.2 论坛体 · 导出长图（同页下部）

- **依赖**：CDN `html2canvas` + `thread-to-image.js`（与正文独立：文本框 **`#tt-input`**，不受上传框影响）。
- **能力**：粘贴论坛体、`【1L｜昵称】` 分段、预览手机壳、`下载 PNG` 9:16 切片；**填入示例** 演示布局。

---

## 5. 我的灵感 / 漫游

与原稿一致：**列表 / 导入导出 JSON**；漫游卡片文案指向「上传素材 → 复制」与「底部导出 PNG」。

---

## 6. 实现清单

- [x] 创作：单上传框 + 预览 + 复制 + 保存  
- [x] 创作：嵌入论坛体导出（原 `thread-to-image` 逻辑）  
- [x] 顶栏：**无 PRD**、无单独出图页（仅锚点）  
- [x] `thread-to-image.html` → 跳转旧版创作页锚点  

---

*`server/` 提供 `/api/chat`；对话与长图导出在 **`index.legacy.html`**。*
