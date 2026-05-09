import { prisma } from './prisma.js';
import { logger } from './logger.js';
import { env } from '../config/env.js';

export interface OtpRetentionResult {
  deletedCount: number;
  cutoff: Date;
}

export async function purgeExpiredOtpCodes(retentionDays = env.OTP_RETENTION_DAYS): Promise<OtpRetentionResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  // OtpCode rows are not tenant-scoped (they belong to TenantUser), so the
  // Prisma extension does not auto-inject a tenantId filter here. Safe to
  // bulk-delete by createdAt.
  const result = await prisma.otpCode.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deletedCount: result.count, cutoff };
}

type SchedulerTrigger = 'startup' | 'interval';

export function startOtpRetentionScheduler() {
  if (!env.OTP_RETENTION_ENABLED || env.NODE_ENV === 'test') {
    if (env.NODE_ENV !== 'test') {
      logger.info('OTP retention scheduler is disabled.');
    }
    return () => {};
  }

  const intervalMs = env.OTP_RETENTION_INTERVAL_MINUTES * 60 * 1_000;
  let running = false;

  const runOnce = async (trigger: SchedulerTrigger) => {
    if (running) {
      logger.warn({ trigger }, 'OTP retention purge skipped because previous run is still in progress.');
      return;
    }
    running = true;
    try {
      const summary = await purgeExpiredOtpCodes();
      if (summary.deletedCount > 0) {
        logger.info({ trigger, ...summary }, 'OTP retention purge completed.');
      }
    } catch (error) {
      logger.error({ err: error, trigger }, 'OTP retention purge failed.');
    } finally {
      running = false;
    }
  };

  if (env.OTP_RETENTION_RUN_ON_STARTUP) {
    void runOnce('startup');
  }

  const timer = setInterval(() => {
    void runOnce('interval');
  }, intervalMs);
  timer.unref?.();

  logger.info(
    {
      retentionDays: env.OTP_RETENTION_DAYS,
      intervalMinutes: env.OTP_RETENTION_INTERVAL_MINUTES,
      runOnStartup: env.OTP_RETENTION_RUN_ON_STARTUP,
    },
    'OTP retention scheduler started.',
  );

  return () => {
    clearInterval(timer);
  };
}
