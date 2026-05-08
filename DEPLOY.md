# 部署说明：Render / Railway

这个项目是「静态前端 + Node/Express 后端」同源部署。后端负责：

- 托管 `web/` 里的页面。
- 提供 `/api/health` 和 `/api/chat`。
- 在服务端读取 `skill.md`、`method.md` 并转发到 Kimi / Moonshot API。
- 保护 `LLM_API_KEY`，不要把密钥写进前端代码。

## 部署前

1. 把项目推到 GitHub。
2. 确认不要提交真实密钥：
   - `server/.env` 不要提交。
   - 部署平台里用 Environment Variables 配置密钥。
3. 根目录已有部署入口：
   - Build Command: `npm install`
   - Start Command: `npm start`

`package.json` 会在根目录安装后自动执行 `npm install --prefix server`，所以平台从仓库根目录部署即可。

## 环境变量

在 Render / Railway 的 Variables / Environment 页面添加：

```env
LLM_API_KEY=你的 Kimi API Key
LLM_BASE_URL=https://api.moonshot.cn/v1
LLM_MODEL=kimi-k2.6
LLM_MAX_TOKENS=8192
```

通常不用手动填 `PORT`，Render / Railway 会自动注入。

如果前端和 API 分开部署，才需要设置：

```env
CORS_ORIGIN=https://你的前端域名
```

本项目推荐同源部署，所以一般留空。

## Render 部署

1. 登录 Render，选择 `New` -> `Web Service`。
2. 连接你的 GitHub 仓库。
3. 设置：
   - Runtime: `Node`
   - Root Directory: 留空
   - Build Command: `npm install`
   - Start Command: `npm start`
4. 在 Environment Variables 添加上面的 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`。
5. Deploy。
6. 部署完成后打开 Render 给你的域名，例如：

```text
https://your-app.onrender.com/
```

健康检查：

```text
https://your-app.onrender.com/api/health
```

看到 `apiKeyConfigured: true` 就说明密钥配置成功。

## Railway 部署

1. 登录 Railway，选择 `New Project` -> `Deploy from GitHub repo`。
2. 选择本项目仓库。
3. Railway 通常会自动识别 Node 项目。
4. 在 Variables 添加：

```env
LLM_API_KEY=你的 Kimi API Key
LLM_BASE_URL=https://api.moonshot.cn/v1
LLM_MODEL=kimi-k2.6
LLM_MAX_TOKENS=8192
```

5. 如果没有自动识别命令，就手动设置：
   - Build Command: `npm install`
   - Start Command: `npm start`
6. 生成公网域名后访问 `/`。

健康检查：

```text
https://你的railway域名/api/health
```

## 本地部署自检

在项目根目录执行：

```bash
npm install
npm start
```

打开：

```text
http://127.0.0.1:3847/
http://127.0.0.1:3847/api/health
```

## 注意事项

- 真实密钥只放部署平台环境变量，不要写进 `web/app.js` 或任何前端文件。
- Kimi 生成长正文可能较慢，Render / Railway 比 Serverless 平台更适合这种长请求。
- 如果开放给所有人使用，建议后续加访问密码、限流或用户额度，否则你的 API 余额可能被消耗很快。
