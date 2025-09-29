import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 静态导出配置
export const dynamic = 'force-static';
export const revalidate = false;

// 为静态导出生成参数
export async function generateStaticParams() {
  // 返回空数组，因为这是一个动态API路由，在静态导出时不需要预生成
  return [];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    
    // 验证文件名安全性
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json(
        { error: '无效的文件名' },
        { status: 400 }
      );
    }
    
    // 构建文件路径
    const filePath = path.join(process.cwd(), 'temp', 'images', filename);
    
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: '文件不存在' },
        { status: 404 }
      );
    }
    
    // 读取文件
    const fileBuffer = await fs.promises.readFile(filePath);
    
    // 根据文件扩展名确定MIME类型
    const extension = path.extname(filename).toLowerCase();
    let mimeType = 'application/octet-stream';
    
    switch (extension) {
      case '.jpg':
      case '.jpeg':
        mimeType = 'image/jpeg';
        break;
      case '.png':
        mimeType = 'image/png';
        break;
      case '.gif':
        mimeType = 'image/gif';
        break;
      case '.webp':
        mimeType = 'image/webp';
        break;
    }
    
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
      },
    });
    
  } catch (error) {
    console.error('获取图片失败:', error);
    return NextResponse.json(
      { error: '获取图片失败' },
      { status: 500 }
    );
  }
}