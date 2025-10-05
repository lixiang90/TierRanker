import path from 'path';

export function getTempImagesDir(): string {
  const isVercel = !!process.env.VERCEL || process.env.NOW_REGION !== undefined;
  if (isVercel) {
    return path.join('/tmp', 'images');
  }
  return path.join(process.cwd(), 'temp', 'images');
}

export function getTempImagePath(filename: string): string {
  return path.join(getTempImagesDir(), filename);
}