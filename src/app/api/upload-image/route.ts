import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { put } from '@vercel/blob';
import { v4 as uuidv4 } from 'uuid';
import { getTempImagesDir, getTempImagePath } from '@/lib/temp-dir';

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
    const buffer = Buffer.from(base64Data, 'base64');

    // 如果在 Vercel 且配置了 Blob 写入令牌，则走持久存储
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const isVercel = !!process.env.VERCEL || process.env.NOW_REGION !== undefined;
    if (isVercel && token) {
      try {
        const result = await put(uniqueFileName, buffer, {
          access: 'public',
          token,
        });
        return NextResponse.json({
          success: true,
          imageUrl: result.url,
          fileName: uniqueFileName
        });
      } catch (err) {
        console.error('上传到 Vercel Blob 失败，回退到本地临时目录:', err);
      }
    }

    // 本地或无令牌：写入临时目录作为回退
    const tempDir = getTempImagesDir();
    await fs.promises.mkdir(tempDir, { recursive: true });
    const filePath = getTempImagePath(uniqueFileName);
    await fs.promises.writeFile(filePath, buffer);

    const imageUrl = `/api/temp-image/${uniqueFileName}`;
    return NextResponse.json({ success: true, imageUrl, fileName: uniqueFileName });
    
  } catch (error) {
    console.error('图片上传失败:', error);
    return NextResponse.json(
      { error: '图片上传失败' },
      { status: 500 }
    );
  }
}