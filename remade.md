# 设计还原说明（Figma Make → 静态站）

## 原型链接

[Figma Make · 社媒小说创作工作台](https://www.figma.com/make/NJG7lxUJHccH9DhARoln8U/%E7%A4%BE%E5%AA%92%E5%B0%8F%E8%AF%B4%E5%88%9B%E4%BD%9C%E5%B7%A5%E4%BD%9C%E5%8F%B0?t=LYcnDezpSXdFnC8a-20&fullscreen=1)

## 当前实现位置

- **默认主页**：`web/index.html`（Figma 三屏，`figma-pixel.css`、`figma-pixel.js`）
- **旧版工作台**（API 对话、长图）：`web/index.legacy.html`、`web/styles.css`、`web/app.js`、`web/thread-to-image.js`
- **书签**：`web/index-figma.html` → 重定向到 `/`

## 为何不能「一键像素级」从 Make 拉取

- **Figma Make** 多为交互原型 / 生成式画布，与 **Figma Design** 里带 `node-id=` 的「复制选中项链接」不是同一套给 MCP 的入口。
- 在 Cursor 里 **像素级复原**，需要其一：  
  1. **Figma MCP 已连通**，且你能提供 **Design 文件里具体 Frame 的链接**（右键 *Copy link to selection*）；或  
  2. 从 Make / Design **导出整页 PNG**（或分屏截图），把图贴进对话，并标出与 `web/` 的差异清单。

## 你接下来可以怎么做

1. 在浏览器打开上面 Make 链接，**全页截图**或导出关键 Frame。  
2. 把图发回对话，列出：「顶栏 / 主卡片 / 间距 / 字体大小」与当前 `index.html` 的差异。  
3. 若已迁到 **Figma Design**：复制带 `node-id` 的链接，在 Agent 里说明「按此节点还原到 `web/index.html`」。

本文档随还原进度更新即可。
