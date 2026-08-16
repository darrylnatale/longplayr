import type { NextConfig } from 'next';

/**
 * Album artwork is served from Supabase Storage, whose host differs per
 * environment, so the allowed pattern is derived from the same variable the
 * app already uses rather than hardcoded.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseHost = supabaseUrl ? new URL(supabaseUrl) : null;

const nextConfig: NextConfig = {
  images: {
    // Next 16 blocks image optimization from local IPs by default, as SSRF
    // protection, returning 400. Local Supabase serves artwork from
    // 127.0.0.1, so every cover breaks in development without this.
    //
    // Development only. In deployed environments Supabase has a real hostname,
    // so this is unnecessary there and enabling it would reintroduce the risk
    // the restriction exists to prevent.
    dangerouslyAllowLocalIP: process.env.NODE_ENV === 'development',
    remotePatterns: supabaseHost
      ? [
          {
            protocol: supabaseHost.protocol.replace(':', '') as 'http' | 'https',
            hostname: supabaseHost.hostname,
            port: supabaseHost.port || undefined,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
  },
};

export default nextConfig;
