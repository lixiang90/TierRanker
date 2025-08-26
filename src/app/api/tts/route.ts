import { NextRequest, NextResponse } from 'next/server';
import { getTTSConfig } from '@/lib/tts-config';
import { generateTTS } from '@/lib/tts-providers';

export async function POST(request: NextRequest) {
  try {
    const { text, speaker = 'default' } = await request.json();
    
    if (!text) {
      return NextResponse.json(
        { error: '文本内容不能为空' },
        { status: 400 }
      );
    }

    // 获取TTS配置
    const config = getTTSConfig();
    console.log(`使用TTS提供商: ${config.provider}`);

    // 调用相应的TTS服务
    const result = await generateTTS(text, speaker, config);

    if (!result.success) {
      throw new Error(result.error || 'TTS生成失败');
    }

    return NextResponse.json({
      success: true,
      audioUrl: result.audioUrl,
      duration: result.duration,
      speaker: result.speaker,
      text: result.text,
      provider: config.provider
    });

  } catch (error) {
    console.error('TTS生成失败:', error);
    return NextResponse.json(
      { error: `TTS生成失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}