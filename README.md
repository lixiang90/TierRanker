# 从夯到拉生成器

生成在bilibili流行的”从夯到拉排行榜“并导出解说视频。

## 配置
排行榜功能不需要设置参数，直接运行即可。视频导出需要配置tts提供者，参考[TTS_CONFIGURATION.md](TTS_CONFIGURATION.md)。

## 运行
本项目基于next.js，安装node.js,npm和相应依赖后，使用
```bash
npm run dev
```
启动项目。打开浏览器，访问`http://localhost:3000`即可。
