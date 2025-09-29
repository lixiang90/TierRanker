import { NextRequest, NextResponse } from 'next/server';
import { getTTSConfig, getDefaultSpeakers } from '@/lib/tts-config';



export async function GET(request: NextRequest) {
  try {
    const config = getTTSConfig();
    
    // 如果是CosyVoice，尝试从API获取说话人列表
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
      } catch (error) {
        console.warn('无法连接到CosyVoice API，使用默认说话人列表');
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