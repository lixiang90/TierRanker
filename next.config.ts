import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ['canvas', 'ffmpeg-static', '@ffprobe-installer/ffprobe'],
  trailingSlash: true,
  images: {
    unoptimized: true
  },

  // 增加请求体大小限制以支持包含图片的请求
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Max-Age',
            value: '86400'
          }
        ]
      }
    ];
  }
};

export default nextConfig;
