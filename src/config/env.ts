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
  JWT_ACCESS_EXPIRY: z.string().default('5m'),
  JWT_REFRESH_EXPIRY: z.string().default('12h'),
  SESSION_IDLE_TIMEOUT: z.string().default('15m'),
  SESSION_WARNING_WINDOW_SECONDS: z.coerce.number().int().min(0).default(300),
  AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default('__Host-zikel_rt'),
  AUTH_REFRESH_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  AUTH_REFRESH_COOKIE_PATH: z.string().min(1).default('/'),
  AUTH_REFRESH_COOKIE_DOMAIN: z.string().min(1).optional(),
  AUTH_LEGACY_REFRESH_TOKEN_IN_BODY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

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
    .default('http://localhost:3000'),

  // AI (provider-backed with fallback)
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  AI_BASE_URL: z.url({ error: 'AI_BASE_URL must be a valid URL' }).default('https://api.openai.com/v1'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  AI_CONTEXT_REDACTION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AI_CONTEXT_REDACTION_MODE: z.enum(['standard', 'strict']).default('strict'),
  AI_CONTEXT_REDACTION_SENSITIVE_KEYS: z
    .string()
    .default(
      [
        'firstName',
        'lastName',
        'middleName',
        'fullName',
        'name',
        'email',
        'phone',
        'phoneNumber',
        'address',
        'dob',
        'dateOfBirth',
        'niNumber',
        'nhsNumber',
        'medical',
        'diagnosis',
        'passport',
      ].join(','),
    ),

  // Email — Resend (https://resend.com)
  // Optional in development (email.ts logs OTPs to console instead).
  // Required in production: set via your hosting platform's secret manager.
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

  // Safeguarding risk-alert scheduled backfill
  SAFEGUARDING_RISK_BACKFILL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SAFEGUARDING_RISK_BACKFILL_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  SAFEGUARDING_RISK_BACKFILL_LOOKBACK_HOURS: z.coerce.number().int().min(24).max(24 * 30).default(24 * 7),
  SAFEGUARDING_RISK_BACKFILL_RUN_ON_STARTUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SAFEGUARDING_RISK_BACKFILL_SEND_EMAIL_HOOKS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SAFEGUARDING_CHRONOLOGY_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  SAFEGUARDING_PATTERNS_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  SAFEGUARDING_RISK_ALERT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE: z.enum(['standard', 'restricted']).default('standard'),

  // Therapeutic rollout feature flags + pilot controls
  THERAPEUTIC_REG_PACKS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  THERAPEUTIC_CHRONOLOGY_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  THERAPEUTIC_RISK_ALERTS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  THERAPEUTIC_PATTERNS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  THERAPEUTIC_RI_DASHBOARD_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  THERAPEUTIC_REFLECTIVE_PROMPTS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  THERAPEUTIC_PILOT_MODE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  THERAPEUTIC_PILOT_TENANT_IDS: z.string().default(''),
  THERAPEUTIC_TELEMETRY_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  THERAPEUTIC_ROLLOUT_WAVE_LABEL: z.string().min(1).default('general'),

  // File uploads (direct-to-object-storage via presigned URLs)
  UPLOADS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  UPLOADS_S3_BUCKET: z.string().min(1).optional(),
  UPLOADS_S3_REGION: z.string().min(1).default('eu-west-1'),
  UPLOADS_S3_ENDPOINT: z.url({ error: 'UPLOADS_S3_ENDPOINT must be a valid URL' }).optional(),
  UPLOADS_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  UPLOADS_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  UPLOADS_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  UPLOADS_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  UPLOADS_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
  UPLOADS_ALLOWED_MIME_TYPES: z.string().default(
    [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml',
    ].join(','),
  ),
  UPLOADS_PUBLIC_BASE_URL: z.url({ error: 'UPLOADS_PUBLIC_BASE_URL must be a valid URL' }).optional(),

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

    if (!parsed.AUTH_REFRESH_COOKIE_NAME.startsWith('__Host-') && !parsed.AUTH_REFRESH_COOKIE_NAME.startsWith('__Secure-')) {
      throw new Error(
        'AUTH_REFRESH_COOKIE_NAME should use a secure prefix (__Host- or __Secure-) in staging/production.',
      );
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

  if (parsed.UPLOADS_ENABLED) {
    if (!parsed.UPLOADS_S3_BUCKET) {
      throw new Error('UPLOADS_S3_BUCKET is required when UPLOADS_ENABLED=true.');
    }
    if (!parsed.UPLOADS_S3_ACCESS_KEY_ID || !parsed.UPLOADS_S3_SECRET_ACCESS_KEY) {
      throw new Error(
        'UPLOADS_S3_ACCESS_KEY_ID and UPLOADS_S3_SECRET_ACCESS_KEY are required when UPLOADS_ENABLED=true.',
      );
    }
  }

  if (
    (parsed.NODE_ENV === 'staging' || parsed.NODE_ENV === 'production') &&
    parsed.UPLOADS_ENABLED
  ) {
    if (parsed.UPLOADS_S3_ENDPOINT && !parsed.UPLOADS_S3_ENDPOINT.startsWith('https://')) {
      throw new Error('UPLOADS_S3_ENDPOINT must use https:// in staging/production.');
    }
    if (parsed.UPLOADS_PUBLIC_BASE_URL && !parsed.UPLOADS_PUBLIC_BASE_URL.startsWith('https://')) {
      throw new Error('UPLOADS_PUBLIC_BASE_URL must use https:// in staging/production.');
    }
  }

  if (parsed.AI_ENABLED && !parsed.AI_API_KEY) {
    throw new Error('AI_API_KEY is required when AI_ENABLED=true.');
  }

  if (parsed.THERAPEUTIC_PILOT_MODE_ENABLED) {
    const tenants = parsed.THERAPEUTIC_PILOT_TENANT_IDS
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (tenants.length === 0) {
      throw new Error(
        'THERAPEUTIC_PILOT_TENANT_IDS must include at least one tenant id when THERAPEUTIC_PILOT_MODE_ENABLED=true.',
      );
    }
  }

  return parsed;
}

export const env = parseEnv();
