import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // 调用CosyVoice2 API获取说话人列表
    const speakersResponse = await fetch('http://localhost:8000/speakers', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!speakersResponse.ok) {
      throw new Error(`获取说话人列表失败: ${speakersResponse.status}`);
    }

    const speakersData = await speakersResponse.json();
    
    return NextResponse.json({
      success: true,
      speakers: speakersData.speakers
    });

  } catch (error) {
    console.error('获取说话人列表失败:', error);
    return NextResponse.json(
      { error: `获取说话人列表失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}