# Vercel 部署指南

本指南将帮助您将排名应用部署到 Vercel 平台。

## 前置准备

### 1. 账户准备
- 注册 [Vercel 账户](https://vercel.com)
- 注册 [GitHub](https://github.com) 账户（推荐）或 GitLab/Bitbucket

### 2. 项目准备
项目已经包含以下配置文件：
- `vercel.json` - Vercel 部署配置
- `.vercelignore` - 部署时忽略的文件
- `next.config.ts` - Next.js 配置

## 部署步骤

### 步骤 1: 推送代码到 GitHub

1. 在 GitHub 上创建新仓库：
   - 访问 [GitHub](https://github.com)
   - 点击 "New repository"
   - 输入仓库名称（如：`ranker-app`）
   - 选择 "Public" 或 "Private"
   - 点击 "Create repository"

2. 将本地代码推送到 GitHub：
   ```bash
   # 添加远程仓库（替换为您的仓库地址）
   git remote add origin https://github.com/YOUR_USERNAME/ranker-app.git
   
   # 推送代码
   git branch -M main
   git push -u origin main
   ```

### 步骤 2: 连接 Vercel

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. 点击 "New Project"
3. 选择 "Import Git Repository"
4. 授权 Vercel 访问您的 GitHub 账户
5. 选择您刚创建的仓库

### 步骤 3: 配置部署设置

1. **项目设置**：
   - Framework Preset: `Next.js`
   - Root Directory: `./`（默认）
   - Build Command: `npm run build`（默认）
   - Output Directory: `.next`（默认）

2. **环境变量**（如果需要）：
   - 点击 "Environment Variables"
   - 添加必要的环境变量（目前项目不需要特殊环境变量）

3. 点击 "Deploy" 开始部署

### 步骤 4: 等待部署完成

- 部署通常需要 2-5 分钟
- 您可以在部署日志中查看进度
- 部署成功后，Vercel 会提供一个 `.vercel.app` 域名

## 重要配置说明

### Canvas 依赖处理
项目使用了 `canvas` 库来生成视频帧，Vercel 配置已经包含：
```json
{
  "build": {
    "env": {
      "CANVAS_PREBUILT": "false"
    }
  }
}
```

### TTS（文本转语音）配置
项目支持多种TTS服务提供商，需要在Vercel中配置相应的环境变量：

#### 本地开发（CosyVoice）
```bash
TTS_PROVIDER=cosyvoice
TTS_API_URL=http://localhost:8000
```

#### 生产环境推荐配置

**选项1：gTTS（免费推荐）**
```bash
TTS_PROVIDER=gtts
```
*注意：需要在Vercel环境中安装Python和gTTS包*

**选项2：OpenAI TTS（付费推荐）**
```bash
TTS_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
```

**选项3：Azure TTS**
```bash
TTS_PROVIDER=azure
AZURE_TTS_KEY=your_azure_subscription_key
AZURE_TTS_REGION=your_azure_region
```

**选项4：自定义TTS服务**
```bash
TTS_PROVIDER=cosyvoice
TTS_API_URL=https://your-tts-service.com
```

### API 路由超时设置
视频生成可能需要较长时间，已配置：
```json
{
  "functions": {
    "src/app/api/generate-video/route.ts": {
      "maxDuration": 300
    }
  }
}
```

### 文件上传限制
由于 Vercel 的限制，大文件上传可能会遇到问题。建议：
- 图片大小控制在 4.5MB 以内
- 视频生成时长不超过 5 分钟

## 自动部署

配置完成后，每次推送到 `main` 分支都会自动触发部署：
```bash
# 提交更改
git add .
git commit -m "Update features"
git push origin main
```

## 自定义域名（可选）

1. 在 Vercel Dashboard 中选择您的项目
2. 进入 "Settings" > "Domains"
3. 添加您的自定义域名
4. 按照提示配置 DNS 记录

## 故障排除

### 常见问题

1. **Canvas 构建失败**：
   - 确保 `vercel.json` 中包含 `CANVAS_PREBUILT: false`
   - 检查 `next.config.ts` 中的 `serverExternalPackages: ['canvas']`

2. **API 超时**：
   - 检查 `vercel.json` 中的 `maxDuration` 设置
   - 优化视频生成逻辑，减少处理时间

3. **文件上传失败**：
   - 减小图片文件大小
   - 检查网络连接

4. **构建失败**：
   - 检查 `package.json` 中的依赖版本
   - 查看 Vercel 构建日志获取详细错误信息

### 查看日志

- 在 Vercel Dashboard 中点击部署记录
- 查看 "Function Logs" 了解运行时错误
- 查看 "Build Logs" 了解构建错误

## 性能优化建议

1. **图片优化**：
   - 使用 WebP 格式
   - 压缩图片大小
   - 考虑使用 CDN

2. **代码分割**：
   - Next.js 自动进行代码分割
   - 使用动态导入减少初始包大小

3. **缓存策略**：
   - 利用 Vercel 的边缘缓存
   - 设置适当的缓存头

## 监控和分析

- 使用 Vercel Analytics 监控性能
- 查看 "Functions" 标签页了解 API 使用情况
- 设置告警通知

---

部署完成后，您的排名应用将在 `https://your-project-name.vercel.app` 上可用。

如有问题，请查看 [Vercel 官方文档](https://vercel.com/docs) 或联系技术支持。