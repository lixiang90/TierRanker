// TTS服务配置
export interface TTSConfig {
  provider: 'cosyvoice' | 'openai' | 'azure' | 'google' | 'aws' | 'gtts';
  apiUrl?: string;
  apiKey?: string;
  region?: string;
}

export interface TTSResponse {
  success: boolean;
  audioUrl?: string;
  duration?: number;
  speaker?: string;
  text?: string;
  error?: string;
}

export function getTTSConfig(): TTSConfig {
  const provider = (process.env.TTS_PROVIDER || 'cosyvoice') as TTSConfig['provider'];
  
  return {
    provider,
    apiUrl: process.env.TTS_API_URL || 'http://localhost:8000',
    apiKey: process.env.OPENAI_API_KEY || process.env.AZURE_TTS_KEY || process.env.GOOGLE_TTS_KEY,
    region: process.env.AZURE_TTS_REGION || process.env.AWS_REGION
  };
}

// 默认说话人配置
export const DEFAULT_SPEAKERS = {
  cosyvoice: ['default', 'female', 'male'],
  openai: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  azure: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural'],
  google: ['zh-CN-Standard-A', 'zh-CN-Standard-B', 'zh-CN-Standard-C'],
  aws: ['Zhiyu'],
  gtts: ['zh', 'en', 'ja', 'ko']
};

export function getDefaultSpeakers(provider: TTSConfig['provider']): string[] {
  return DEFAULT_SPEAKERS[provider] || ['default'];
}