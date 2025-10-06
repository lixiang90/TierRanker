import { NextRequest, NextResponse } from 'next/server';
import { getTTSConfig, getDefaultSpeakers } from '@/lib/tts-config';

// SiliconFlow 声库类型定义，避免使用 any
interface SiliconFlowVoiceItem {
  model?: string;
  customName?: string;
  text?: string;
  uri?: string;
}

interface SiliconFlowVoiceList {
  results?: SiliconFlowVoiceItem[];
  result?: SiliconFlowVoiceItem[];
}



export async function GET(_request: NextRequest) {
  try {
    const config = getTTSConfig();
    
    // 如果是CosyVoice，尝试从API获取说话人列表（本地服务）
    if (config.provider === 'cosyvoice') {
      try {
        const speakersResponse = await fetch(`${config.apiUrl}/speakers`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (speakersResponse.ok) {
          const speakersData = await speakersResponse.json();
          return NextResponse.json({
            success: true,
            speakers: speakersData.speakers,
            provider: config.provider
          });
        }
      } catch {
        console.warn('无法连接到CosyVoice API，使用默认说话人列表');
      }
    }

    // 如果是SiliconFlow远程服务，调用官方声库接口
    if (config.provider === 'siliconflow') {
      try {
        const envDefaultVoice = process.env.SILICONFLOW_DEFAULT_VOICE || process.env.SILICONFLOW_DEFAULT_VOICE_URI;
        if (!config.apiKey) {
          // 无令牌时，优先返回环境中配置的默认voice URI，便于前端直接选择
          return NextResponse.json({
            success: true,
            speakers: envDefaultVoice ? [envDefaultVoice] : getDefaultSpeakers('siliconflow'),
            provider: config.provider
          });
        }
        const response = await fetch('https://api.siliconflow.cn/v1/audio/voice/list', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.apiKey}`
          },
          body: undefined
        });

        if (response.ok) {
          const data = (await response.json()) as SiliconFlowVoiceList;
          // 兼容两种返回键：results 与 result
          const list: SiliconFlowVoiceItem[] = Array.isArray(data.results)
            ? data.results
            : Array.isArray(data.result)
              ? data.result
              : [];
          // 返回可用的完整 voice URI 列表；若为空，回退到环境变量配置
          let speakers: string[] = list
            .map((r) => (typeof r.uri === 'string' ? r.uri : null))
            .filter((u): u is string => Boolean(u));

          // 将环境默认音色置顶，确保前端默认选中它
          const envDefault = process.env.SILICONFLOW_DEFAULT_VOICE || process.env.SILICONFLOW_DEFAULT_VOICE_URI;
          if (envDefault && envDefault.trim()) {
            if (speakers.includes(envDefault)) {
              speakers = [envDefault, ...speakers.filter(s => s !== envDefault)];
            } else {
              speakers = [envDefault, ...speakers];
            }
          }

          if (speakers.length === 0) {
            const envList = process.env.SILICONFLOW_VOICE_URIS;
            const envDefault = process.env.SILICONFLOW_DEFAULT_VOICE || process.env.SILICONFLOW_DEFAULT_VOICE_URI;
            if (envList && envList.trim()) {
              speakers = envList.split(',').map(s => s.trim()).filter(Boolean);
            } else if (envDefault && envDefault.trim()) {
              speakers = [envDefault.trim()];
            } else {
              speakers = getDefaultSpeakers('siliconflow');
            }
          }

          return NextResponse.json({
            success: true,
            speakers,
            provider: config.provider
          });
        }
      } catch {
        const envDefaultVoice = process.env.SILICONFLOW_DEFAULT_VOICE || process.env.SILICONFLOW_DEFAULT_VOICE_URI;
        console.warn('SiliconFlow 声库接口不可用，回退默认说话人或环境默认voice');
        return NextResponse.json({
          success: true,
          speakers: envDefaultVoice ? [envDefaultVoice] : getDefaultSpeakers('siliconflow'),
          provider: config.provider
        });
      }
    }
    
    // 使用默认说话人列表
    const speakers = getDefaultSpeakers(config.provider);
    
    return NextResponse.json({
      success: true,
      speakers: speakers,
      provider: config.provider
    });

  } catch (error) {
    console.error('获取说话人列表失败:', error);
    return NextResponse.json(
      { error: `获取说话人列表失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}