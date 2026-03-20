import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.url({ error: 'DATABASE_URL must be a valid URL' }),
  DIRECT_URL: z.url({ error: 'DIRECT_URL must be a valid URL' }).optional(),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Swagger / OpenAPI docs UI
  // Auto-enabled in development only. Explicitly set true to enable elsewhere.
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true'),
  SWAGGER_BASIC_AUTH_USERNAME: z.string().min(1).optional(),
  SWAGGER_BASIC_AUTH_PASSWORD: z.string().min(12).optional(),

  // Public backend URL used for email-safe hosted assets (e.g. logo SVG).
  PUBLIC_BASE_URL: z.url({ error: 'PUBLIC_BASE_URL must be a valid URL' })
    .default('https://zikel-solutions-be.onrender.com'),

  // AI (provider-backed with fallback)
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  AI_BASE_URL: z.url({ error: 'AI_BASE_URL must be a valid URL' }).default('https://api.openai.com/v1'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),

  // Email — Resend (https://resend.com)
  // Optional in development (email.ts logs OTPs to console instead).
  // Required in production: set via `fly secrets set`.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.email({ error: 'RESEND_FROM_EMAIL must be a valid email address' }).optional(),

  // Security alert pipeline
  SECURITY_ALERT_PIPELINE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SECURITY_ALERT_WEBHOOK_URL: z.url({ error: 'SECURITY_ALERT_WEBHOOK_URL must be a valid URL' }).optional(),
  SECURITY_ALERT_WEBHOOK_SHARED_SECRET: z.string().min(16).optional(),
  SECURITY_ALERT_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SECURITY_ALERT_WEBHOOK_MAX_DRIFT_SECONDS: z.coerce.number().int().positive().default(300),

});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  // Default SWAGGER_ENABLED based on NODE_ENV so no extra config is needed in dev
  if (!process.env.SWAGGER_ENABLED) {
    const nodeEnv = process.env.NODE_ENV;
    process.env.SWAGGER_ENABLED = nodeEnv === 'development' ? 'true' : 'false';
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  const parsed = result.data;

  if (parsed.NODE_ENV === 'staging' || parsed.NODE_ENV === 'production') {
    if (!parsed.DATABASE_URL.includes('sslmode=require')) {
      throw new Error('DATABASE_URL must enforce TLS (sslmode=require) in staging/production.');
    }
    if (parsed.DIRECT_URL && !parsed.DIRECT_URL.includes('sslmode=require')) {
      throw new Error('DIRECT_URL must enforce TLS (sslmode=require) in staging/production.');
    }
    if (!parsed.PUBLIC_BASE_URL.startsWith('https://')) {
      throw new Error('PUBLIC_BASE_URL must use https:// in staging/production.');
    }

    const origins = parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
    if (origins.some((origin) => origin === '*')) {
      throw new Error('CORS_ORIGINS cannot include wildcard (*) in staging/production.');
    }
    const isLocalhost = (o: string) =>
      o.startsWith('http://localhost:') || o.startsWith('http://127.0.0.1:');
    if (origins.some((origin) => !origin.startsWith('https://') && !isLocalhost(origin))) {
      throw new Error('CORS_ORIGINS must be https:// origins (localhost is allowed for testing) in staging/production.');
    }

    if (parsed.SECURITY_ALERT_PIPELINE_ENABLED && !parsed.SECURITY_ALERT_WEBHOOK_URL) {
      throw new Error(
        'SECURITY_ALERT_WEBHOOK_URL is required in staging/production when SECURITY_ALERT_PIPELINE_ENABLED=true.',
      );
    }
    if (parsed.SECURITY_ALERT_PIPELINE_ENABLED && !parsed.SECURITY_ALERT_WEBHOOK_SHARED_SECRET) {
      throw new Error(
        'SECURITY_ALERT_WEBHOOK_SHARED_SECRET is required in staging/production when SECURITY_ALERT_PIPELINE_ENABLED=true.',
      );
    }

    if (
      parsed.SECURITY_ALERT_WEBHOOK_URL &&
      !parsed.SECURITY_ALERT_WEBHOOK_URL.startsWith('https://')
    ) {
      throw new Error('SECURITY_ALERT_WEBHOOK_URL must use https:// in staging/production.');
    }

    if (parsed.SECURITY_ALERT_WEBHOOK_URL) {
      const webhookOrigin = new URL(parsed.SECURITY_ALERT_WEBHOOK_URL).origin;
      const publicOrigin = new URL(parsed.PUBLIC_BASE_URL).origin;
      if (
        webhookOrigin === publicOrigin &&
        !parsed.SECURITY_ALERT_WEBHOOK_SHARED_SECRET
      ) {
        throw new Error(
          'SECURITY_ALERT_WEBHOOK_SHARED_SECRET is required when SECURITY_ALERT_WEBHOOK_URL points to this backend in staging/production.',
        );
      }
    }

    if (parsed.SWAGGER_ENABLED) {
      if (!parsed.SWAGGER_BASIC_AUTH_USERNAME || !parsed.SWAGGER_BASIC_AUTH_PASSWORD) {
        throw new Error(
          'SWAGGER_BASIC_AUTH_USERNAME and SWAGGER_BASIC_AUTH_PASSWORD are required when SWAGGER_ENABLED=true outside development.',
        );
      }
    }

  }

  if (parsed.AI_ENABLED && !parsed.AI_API_KEY) {
    throw new Error('AI_API_KEY is required when AI_ENABLED=true.');
  }

  return parsed;
}

export const env = parseEnv();
