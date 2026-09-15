// src/config/cors.ts

export const ALLOWED_ORIGINS = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : [
      'https://bot.bigviewbot.online',
      'https://server.bigviewbot.online',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173'
    ];

export const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return true; // Allow non-browser requests (Postman, cURL, server-to-server)
  
  const isVercelDomain = origin.endsWith('.vercel.app');
  const isExplicitlyAllowed = ALLOWED_ORIGINS.includes(origin);

  return isExplicitlyAllowed || isVercelDomain;
};