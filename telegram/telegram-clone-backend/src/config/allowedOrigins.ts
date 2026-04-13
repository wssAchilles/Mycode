const STATIC_ALLOWED_ORIGINS: Array<string | RegExp> = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://telegram-liart-rho.vercel.app',
  /\.vercel\.app$/,
  'https://telegram-467705.web.app',
  'https://telegram-467705.firebaseapp.com',
];

function readExtraOrigins(): string[] {
  const raw = [
    process.env.FRONTEND_ORIGIN,
    process.env.FRONTEND_ORIGINS,
    process.env.CORS_EXTRA_ORIGINS,
  ]
    .filter(Boolean)
    .join(',');

  if (!raw.trim()) return [];

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getAllowedOrigins(): Array<string | RegExp> {
  return [...STATIC_ALLOWED_ORIGINS, ...readExtraOrigins()];
}

export function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) return true;

  return getAllowedOrigins().some((entry) => {
    if (typeof entry === 'string') {
      return entry === origin;
    }
    return entry.test(origin);
  });
}
