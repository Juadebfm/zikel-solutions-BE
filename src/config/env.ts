import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid URL' }),
  DIRECT_URL: z.string().url({ message: 'DIRECT_URL must be a valid URL' }).optional(),

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
  // Auto-enabled in development/staging. Explicitly set false to disable.
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  // Default SWAGGER_ENABLED based on NODE_ENV so no extra config is needed in dev
  if (!process.env.SWAGGER_ENABLED) {
    const env = process.env.NODE_ENV;
    process.env.SWAGGER_ENABLED = env !== 'production' && env !== 'test' ? 'true' : 'false';
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data;
}

export const env = parseEnv();
