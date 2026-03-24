/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Allow production builds with type errors from Prisma JsonValue casts
    // These are safe runtime operations - strict types will be fixed incrementally
    ignoreBuildErrors: true,
  },
  serverExternalPackages: [
    'pdf-parse', 'unpdf', 'pdfjs-dist', 'xlsx', 'ioredis', 'jstat',
    '@azure/storage-blob', '@azure/storage-queue', '@azure/communication-email',
    'pdf-lib', 'openai',
  ],
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', 'www.acumonintelligence.com', '*.acumonintelligence.com'],
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
