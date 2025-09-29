# TTS（文本转语音）配置指南

本项目支持多种TTS服务提供商，可以根据部署环境和需求选择合适的TTS服务。

## 支持的TTS提供商

### 1. CosyVoice（本地开发推荐）
- **适用场景**：本地开发、自建服务器
- **优点**：免费、高质量中文语音、支持多种说话人
- **缺点**：需要本地部署服务

**安装和启动CosyVoice API**
详见[CosyVoice2SimpleAPI项目](https://github.com/lixiang90/CosyVoice2SimpleAPI)

**配置方式：**
```bash
TTS_PROVIDER=cosyvoice
TTS_API_URL=http://localhost:8000
```

### 2. gTTS（免费推荐）
- **适用场景**：开发测试、预算有限的项目
- **优点**：完全免费、支持多种语言、无需API密钥
- **缺点**：音质一般、语音选择有限、需要Python环境

**配置方式：**
```bash
TTS_PROVIDER=gtts
```

**支持的语言：**
- `zh` - 中文
- `en` - 英文
- `ja` - 日文
- `ko` - 韩文

**环境要求：**
- 需要安装Python和gTTS包：`pip install gtts`

### 3. OpenAI TTS（生产环境推荐）
- **适用场景**：生产环境、Vercel部署
- **优点**：稳定可靠、支持多种语言、API简单
- **缺点**：按使用量付费

**配置方式：**
```bash
TTS_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
```

**支持的说话人：**
- `alloy` - 中性声音
- `echo` - 男性声音
- `fable` - 英式口音
- `onyx` - 深沉男声
- `nova` - 年轻女声
- `shimmer` - 温和女声

### 4. Azure TTS
- **适用场景**：企业环境、需要高度定制
- **优点**：支持SSML、丰富的中文说话人
- **缺点**：配置复杂、需要Azure账户

**配置方式：**
```bash
TTS_PROVIDER=azure
AZURE_TTS_KEY=your_azure_subscription_key
AZURE_TTS_REGION=your_azure_region
```

**支持的中文说话人：**
- `zh-CN-XiaoxiaoNeural` - 女声
- `zh-CN-YunxiNeural` - 男声
- `zh-CN-YunjianNeural` - 男声

## 部署环境配置

### 本地开发
1. 复制 `.env.example` 为 `.env.local`
2. 配置相应的环境变量
3. 启动开发服务器

### Vercel部署
1. 在Vercel项目设置中添加环境变量
2. 推荐使用OpenAI TTS（最简单）
3. 重新部署项目

**Vercel环境变量设置：**
```
TTS_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-key
```

### 自建服务器
1. 可以继续使用CosyVoice
2. 或者使用云端TTS服务
3. 配置相应的环境变量

## 故障排除

### 常见问题

**1. TTS服务无响应**
- 检查网络连接
- 验证API密钥是否正确
- 查看服务器日志

**2. 音频质量问题**
- 尝试不同的说话人
- 调整文本内容（避免特殊字符）
- 检查TTS服务的限制

**3. Vercel部署后TTS不工作**
- 确认环境变量已正确设置
- 检查API密钥权限
- 查看Vercel函数日志

### 调试方法

1. **检查TTS配置**
```javascript
// 在浏览器控制台中运行
fetch('/api/speakers')
  .then(res => res.json())
  .then(data => console.log(data));
```

2. **测试TTS功能**
```javascript
// 测试TTS生成
fetch('/api/tts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '测试文本', speaker: 'default' })
})
.then(res => res.json())
.then(data => console.log(data));
```

## 成本考虑

### OpenAI TTS定价（参考）
- 标准质量：$15.00 / 1M 字符
- 高清质量：$30.00 / 1M 字符

### Azure TTS定价（参考）
- 标准语音：$4.00 / 1M 字符
- 神经语音：$16.00 / 1M 字符

### 建议
- 开发环境：使用免费的CosyVoice
- 生产环境：根据预算选择OpenAI或Azure
- 大量使用：考虑自建TTS服务

## 扩展支持

项目架构支持轻松添加新的TTS提供商：

1. 在 `src/lib/tts-providers.ts` 中添加新的提供商函数
2. 在 `src/lib/tts-config.ts` 中添加配置选项
3. 更新环境变量配置

欢迎贡献更多TTS服务的支持！