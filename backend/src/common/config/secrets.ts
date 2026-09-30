import { ConfigService } from '@nestjs/config';

/** Example values shipped in .env.example; never acceptable in production. */
const PLACEHOLDERS = new Set([
  'your-jwt-access-secret-minimum-32-chars-long',
  'your-jwt-refresh-secret-minimum-32-chars-long',
]);

type SecretKey = 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET';

/**
 * Returns a signing secret, refusing to run with a missing, short, or (in production)
 * example value. There is deliberately no fallback: a known default would let anyone forge tokens.
 */
export function jwtSecret(config: Pick<ConfigService, 'get'>, key: SecretKey): string {
  const value = config.get<string>(key)?.trim() ?? '';
  if (value.length < 32) {
    throw new Error(`${key} must be a random value of at least 32 characters (e.g. openssl rand -base64 48).`);
  }
  if (process.env.NODE_ENV === 'production' && PLACEHOLDERS.has(value)) {
    throw new Error(`${key} still has the example value from .env.example. Generate a real secret.`);
  }
  return value;
}

/** Startup check: both secrets valid and different. */
export function assertAuthConfig(config: Pick<ConfigService, 'get'>) {
  const access = jwtSecret(config, 'JWT_ACCESS_SECRET');
  const refresh = jwtSecret(config, 'JWT_REFRESH_SECRET');
  if (access === refresh) throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
}
