import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const { text, speaker = 'default' } = await request.json();
    
    if (!text) {
      return NextResponse.json(
        { error: '文本内容不能为空' },
        { status: 400 }
      );
    }

    // 调用CosyVoice2 API
    const ttsResponse = await fetch(`http://localhost:8000/tts?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(speaker)}`, {
      method: 'POST'
    });

    if (!ttsResponse.ok) {
      throw new Error(`TTS API调用失败: ${ttsResponse.status}`);
    }

    const ttsResult = await ttsResponse.json();
    
    if (!ttsResult.original_audio) {
      throw new Error('TTS API未返回音频文件路径');
    }

    // 下载生成的音频文件
    const audioResponse = await fetch(`http://localhost:8000/download?file=${encodeURIComponent(ttsResult.original_audio)}`);
    
    if (!audioResponse.ok) {
      throw new Error(`音频文件下载失败: ${audioResponse.status}`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    
    // 将音频数据转换为base64
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    const mimeType = ttsResult.original_audio.endsWith('.mp3') ? 'audio/mp3' : 'audio/wav';
    const audioDataUrl = `data:${mimeType};base64,${base64Audio}`;

    return NextResponse.json({
      success: true,
      audioUrl: audioDataUrl,
      duration: ttsResult.duration,
      speaker: speaker,
      text: text
    });

  } catch (error) {
    console.error('TTS生成失败:', error);
    return NextResponse.json(
      { error: `TTS生成失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}