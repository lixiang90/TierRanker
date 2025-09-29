import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: 'export',
  serverExternalPackages: ['canvas'],
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  // GitHub Pages部署配置
  basePath: process.env.NODE_ENV === 'production' ? '/TierRanker' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/TierRanker/' : '',
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
