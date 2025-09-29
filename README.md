# 从夯到拉生成器

生成在bilibili流行的”从夯到拉排行榜“并导出解说视频。

## 配置

### 环境变量配置
1. 复制 `.env.example` 文件并重命名为 `.env.local`：
   ```bash
   cp .env.example .env.local
   ```
2. 根据需要修改 `.env.local` 中的配置项
3. 默认使用免费的 gTTS (Google Text-to-Speech)，无需额外配置

### TTS 配置详情
排行榜功能不需要设置参数，直接运行即可。视频导出需要配置TTS提供者，详细配置说明请参考 [TTS_CONFIGURATION.md](TTS_CONFIGURATION.md)。

## 运行
本项目基于next.js，安装node.js,npm和相应依赖后，使用
```bash
npm run dev
```
启动项目。打开浏览器，访问`http://localhost:3000`即可。
