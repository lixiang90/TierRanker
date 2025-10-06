import path from 'path';

// 判断是否运行在 Vercel 无服务器环境
function isVercelEnv(): boolean {
  return !!process.env.VERCEL || process.env.NOW_REGION !== undefined;
}

// 返回可写的临时目录基路径：Vercel 使用 /tmp，本地使用项目下 temp
export function getTempBaseDir(): string {
  if (isVercelEnv()) {
    return '/tmp';
  }
  return path.join(process.cwd(), 'temp');
}

export function getTempImagesDir(): string {
  if (isVercelEnv()) {
    return path.join('/tmp', 'images');
  }
  return path.join(process.cwd(), 'temp', 'images');
}

export function getTempImagePath(filename: string): string {
  return path.join(getTempImagesDir(), filename);
}