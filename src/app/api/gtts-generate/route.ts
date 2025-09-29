import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// 静态导出配置
export const dynamic = 'force-static';
export const revalidate = false;

export async function POST(request: NextRequest) {
  try {
    const { text, lang = 'zh' } = await request.json();
    
    if (!text) {
      return NextResponse.json(
        { error: '文本内容不能为空' },
        { status: 400 }
      );
    }

    // 创建临时目录
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 生成唯一的文件名
    const timestamp = Date.now();
    const audioFileName = `gtts_${timestamp}.mp3`;
    const audioFilePath = path.join(tempDir, audioFileName);

    try {
      // 创建Python脚本文件
      const scriptPath = path.join(tempDir, `gtts_script_${timestamp}.py`);
      const pythonScript = `
from gtts import gTTS
import sys
import os

try:
    text = """${text.replace(/"/g, '\\"')}"""
    lang = "${lang}"
    output_file = r"${audioFilePath.replace(/\\/g, '\\\\')}"
    
    # 创建gTTS对象
    tts = gTTS(text=text, lang=lang, slow=False)
    
    # 保存到文件
    tts.save(output_file)
    
    # 检查文件是否生成
    if os.path.exists(output_file):
        print("SUCCESS")
    else:
        print("ERROR: File not created")
        sys.exit(1)
except Exception as e:
    print(f"ERROR: {str(e)}")
    sys.exit(1)
`;

      // 写入Python脚本文件
      fs.writeFileSync(scriptPath, pythonScript);
      
      try {
        // 执行Python脚本
        const { stdout, stderr } = await execAsync(`python "${scriptPath}"`);
        
        if (stderr && !stdout.includes('SUCCESS')) {
          throw new Error(`gTTS生成失败: ${stderr}`);
        }
      } finally {
        // 清理脚本文件
        try {
          fs.unlinkSync(scriptPath);
        } catch (cleanupError) {
          console.warn('清理脚本文件失败:', cleanupError);
        }
      }

      // 检查文件是否生成成功
      if (!fs.existsSync(audioFilePath)) {
        throw new Error('音频文件生成失败');
      }

      // 读取音频文件并转换为base64
      const audioBuffer = fs.readFileSync(audioFilePath);
      const base64Audio = audioBuffer.toString('base64');
      const audioDataUrl = `data:audio/mp3;base64,${base64Audio}`;

      // 估算音频时长（gTTS不提供精确时长）
      const estimatedDuration = text.length * 0.15; // 中文大约每字0.15秒

      // 清理临时文件
      try {
        fs.unlinkSync(audioFilePath);
      } catch (cleanupError) {
        console.warn('清理临时文件失败:', cleanupError);
      }

      return NextResponse.json({
        success: true,
        audioUrl: audioDataUrl,
        duration: estimatedDuration,
        lang: lang,
        text: text
      });

    } catch (error) {
      // 清理可能存在的临时文件
      try {
        if (fs.existsSync(audioFilePath)) {
          fs.unlinkSync(audioFilePath);
        }
      } catch (cleanupError) {
        console.warn('清理临时文件失败:', cleanupError);
      }
      throw error;
    }

  } catch (error) {
    console.error('gTTS生成失败:', error);
    return NextResponse.json(
      { error: `gTTS生成失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}