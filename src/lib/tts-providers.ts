import { TTSConfig, TTSResponse } from './tts-config';

// SiliconFlow 声库返回项与列表类型（避免使用 any）
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

// SiliconFlow CosyVoice2 远程TTS提供商
export async function siliconflowTTS(text: string, speaker: string, config: TTSConfig): Promise<TTSResponse> {
  try {
    if (!config.apiKey) {
      throw new Error('SiliconFlow API令牌未配置 (SILICONFLOW_API_KEY)');
    }

    // 选择voice：优先使用传入的URI；否则尝试从声库选择一个可用的voice，或使用环境变量默认值
    let voiceUri: string | undefined;
    const envDefaultVoice = process.env.SILICONFLOW_DEFAULT_VOICE || process.env.SILICONFLOW_DEFAULT_VOICE_URI;

    const normalizeName = (s: string) => s.trim().toLowerCase();

    if (typeof speaker === 'string' && speaker.startsWith('speech:')) {
      voiceUri = speaker;
    } else {
      // 获取声库列表，并尝试匹配speaker或环境默认值
      try {
        const listResp = await fetch('https://api.siliconflow.cn/v1/audio/voice/list', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${config.apiKey}` }
        });

        if (listResp.ok) {
          const data = (await listResp.json()) as SiliconFlowVoiceList;
          const results: SiliconFlowVoiceItem[] = Array.isArray(data.results)
            ? data.results
            : Array.isArray(data.result)
              ? data.result
              : [];

          // 尝试使用环境默认voice
          if (envDefaultVoice) {
            const envNorm = normalizeName(envDefaultVoice);
            const byName = results.find(v => typeof v?.customName === 'string' && normalizeName(v.customName) === envNorm);
            const byUri = results.find(v => typeof v?.uri === 'string' && normalizeName(v.uri) === envNorm);
            voiceUri = byUri?.uri || byName?.uri || (envDefaultVoice.startsWith('speech:') ? envDefaultVoice : undefined);
          }

          // 如果有传入speaker且不是uri，尝试匹配
          if (!voiceUri && speaker) {
            const spNorm = normalizeName(speaker);
            const matchByName = results.find(v => typeof v?.customName === 'string' && normalizeName(v.customName) === spNorm);
            const matchByUriContains = results.find(v => typeof v?.uri === 'string' && v.uri.toLowerCase().includes(spNorm));
            voiceUri = matchByName?.uri || matchByUriContains?.uri;
          }

          // 最后回退到列表的第一个
          if (!voiceUri && results.length > 0 && typeof results[0]?.uri === 'string') {
            voiceUri = results[0].uri;
          }
        }
      } catch {
        // 声库不可用时仅在存在环境默认值且为URI时使用之
        if (envDefaultVoice && envDefaultVoice.startsWith('speech:')) {
          voiceUri = envDefaultVoice;
        }
      }
    }

    if (!voiceUri) {
      throw new Error('未选择到有效的SiliconFlow voice，请在请求中传入voice URI或配置SILICONFLOW_DEFAULT_VOICE');
    }

    // 构造请求体
    const body: Record<string, unknown> = {
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      input: text,
      voice: voiceUri
    };

    const response = await fetch('https://api.siliconflow.cn/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      // 尝试读取JSON错误
      let errDetail = '';
      try {
        const j = await response.text();
        errDetail = j?.slice(0, 200);
      } catch {}
      throw new Error(`SiliconFlow TTS API调用失败: ${response.status} ${errDetail}`);
    }

    const contentType = response.headers.get('content-type') || '';
    // 返回为二进制音频流，转换为Data URL；默认按mp3处理
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    const mimeType = contentType.includes('audio/')
      ? contentType.split(';')[0]
      : 'audio/mp3';
    const audioDataUrl = `data:${mimeType};base64,${base64Audio}`;

    // 估算时长（中文大约每字0.12秒）
    const estimatedDuration = Math.max(2, text.length * 0.12);

    return {
      success: true,
      audioUrl: audioDataUrl,
      duration: estimatedDuration,
      speaker: voiceUri,
      text
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// CosyVoice TTS提供商（本地开发）
export async function cosyvoiceTTS(text: string, speaker: string, config: TTSConfig): Promise<TTSResponse> {
  try {
    const ttsResponse = await fetch(`${config.apiUrl}/tts?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(speaker)}`, {
      method: 'POST'
    });

    if (!ttsResponse.ok) {
      throw new Error(`CosyVoice API调用失败: ${ttsResponse.status}`);
    }

    const ttsResult = await ttsResponse.json();
    
    if (!ttsResult.original_audio) {
      throw new Error('CosyVoice API未返回音频文件路径');
    }

    // 下载生成的音频文件
    const audioResponse = await fetch(`${config.apiUrl}/download?file=${encodeURIComponent(ttsResult.original_audio)}`);
    
    if (!audioResponse.ok) {
      throw new Error(`音频文件下载失败: ${audioResponse.status}`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    const mimeType = ttsResult.original_audio.endsWith('.mp3') ? 'audio/mp3' : 'audio/wav';
    const audioDataUrl = `data:${mimeType};base64,${base64Audio}`;

    return {
      success: true,
      audioUrl: audioDataUrl,
      duration: ttsResult.duration,
      speaker,
      text
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// OpenAI TTS提供商
export async function openaiTTS(text: string, speaker: string, config: TTSConfig): Promise<TTSResponse> {
  try {
    if (!config.apiKey) {
      throw new Error('OpenAI API密钥未配置');
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: speaker || 'alloy',
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS API调用失败: ${response.status}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    const audioDataUrl = `data:audio/mp3;base64,${base64Audio}`;

    // 估算音频时长（OpenAI不直接提供）
    const estimatedDuration = text.length * 0.1; // 粗略估算

    return {
      success: true,
      audioUrl: audioDataUrl,
      duration: estimatedDuration,
      speaker,
      text
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// Azure TTS提供商
export async function azureTTS(text: string, speaker: string, config: TTSConfig): Promise<TTSResponse> {
  try {
    if (!config.apiKey || !config.region) {
      throw new Error('Azure TTS配置不完整');
    }

    const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice xml:lang='zh-CN' name='${speaker || 'zh-CN-XiaoxiaoNeural'}'>${text}</voice></speak>`;

    const response = await fetch(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
      },
      body: ssml
    });

    if (!response.ok) {
      throw new Error(`Azure TTS API调用失败: ${response.status}`);
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    const audioDataUrl = `data:audio/mp3;base64,${base64Audio}`;

    const estimatedDuration = text.length * 0.1;

    return {
      success: true,
      audioUrl: audioDataUrl,
      duration: estimatedDuration,
      speaker,
      text
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// gTTS提供商（Google Text-to-Speech免费版）
export async function gttsTTS(text: string, speaker: string, _config: TTSConfig): Promise<TTSResponse> {
  try {
    // gTTS使用语言代码而不是说话人
    const lang = speaker || 'zh';
    
    // 构建完整的API URL
    const baseUrl = typeof window !== 'undefined' 
      ? window.location.origin 
      : process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'http://localhost:3000';
    
    // 使用gTTS API（需要安装gtts包）
    const response = await fetch(`${baseUrl}/api/gtts-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        lang
      })
    });

    if (!response.ok) {
      throw new Error(`gTTS API调用失败: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'gTTS生成失败');
    }

    return {
      success: true,
      audioUrl: result.audioUrl,
      duration: result.duration,
      speaker: lang,
      text
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误'
    };
  }
}

// TTS提供商工厂函数
export async function generateTTS(text: string, speaker: string, config: TTSConfig): Promise<TTSResponse> {
  switch (config.provider) {
    case 'cosyvoice':
      return cosyvoiceTTS(text, speaker, config);
    case 'siliconflow':
      return siliconflowTTS(text, speaker, config);
    case 'openai':
      return openaiTTS(text, speaker, config);
    case 'azure':
      return azureTTS(text, speaker, config);
    case 'gtts':
      return gttsTTS(text, speaker, config);
    case 'google':
    case 'aws':
      // TODO: 实现Google和AWS TTS
      return {
        success: false,
        error: `${config.provider} TTS提供商暂未实现`
      };
    default:
      return {
        success: false,
        error: '不支持的TTS提供商'
      };
  }
}