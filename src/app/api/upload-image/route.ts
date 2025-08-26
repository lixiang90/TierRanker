import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const { imageData, fileName } = await request.json();
    
    if (!imageData) {
      return NextResponse.json(
        { error: '图片数据不能为空' },
        { status: 400 }
      );
    }

    // 解析base64数据
    const base64Data = imageData.split(',')[1];
    const mimeType = imageData.split(';')[0].split(':')[1];
    const extension = mimeType.split('/')[1];
    
    // 生成唯一文件名
    const uniqueFileName = `${uuidv4()}.${extension}`;
    
    // 创建临时目录
    const tempDir = path.join(process.cwd(), 'temp', 'images');
    await fs.promises.mkdir(tempDir, { recursive: true });
    
    // 保存图片文件
    const filePath = path.join(tempDir, uniqueFileName);
    const buffer = Buffer.from(base64Data, 'base64');
    await fs.promises.writeFile(filePath, buffer);
    
    // 返回图片URL
    const imageUrl = `/api/temp-image/${uniqueFileName}`;
    
    return NextResponse.json({
      success: true,
      imageUrl,
      fileName: uniqueFileName
    });
    
  } catch (error) {
    console.error('图片上传失败:', error);
    return NextResponse.json(
      { error: '图片上传失败' },
      { status: 500 }
    );
  }
}