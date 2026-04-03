import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { runScheduledRiskBackfill } from './risk-alerts.service.js';

type SchedulerTrigger = 'startup' | 'interval';

export function startSafeguardingRiskBackfillScheduler() {
  if (!env.SAFEGUARDING_RISK_BACKFILL_ENABLED) {
    if (env.NODE_ENV !== 'test') {
      logger.info('Safeguarding risk backfill scheduler is disabled.');
    }
    return () => {};
  }

  const intervalMs = env.SAFEGUARDING_RISK_BACKFILL_INTERVAL_MINUTES * 60 * 1_000;
  let running = false;

  const runOnce = async (trigger: SchedulerTrigger) => {
    if (running) {
      logger.warn({ trigger }, 'Safeguarding risk backfill skipped because previous run is still in progress.');
      return;
    }

    running = true;
    try {
      const summary = await runScheduledRiskBackfill({
        lookbackHours: env.SAFEGUARDING_RISK_BACKFILL_LOOKBACK_HOURS,
        sendEmailHooks: env.SAFEGUARDING_RISK_BACKFILL_SEND_EMAIL_HOOKS,
      });
      logger.info({ trigger, ...summary }, 'Safeguarding risk backfill completed.');
    } catch (error) {
      logger.error({ err: error, trigger }, 'Safeguarding risk backfill run failed.');
    } finally {
      running = false;
    }
  };

  if (env.SAFEGUARDING_RISK_BACKFILL_RUN_ON_STARTUP) {
    void runOnce('startup');
  }

  const timer = setInterval(() => {
    void runOnce('interval');
  }, intervalMs);
  timer.unref?.();

  logger.info(
    {
      intervalMinutes: env.SAFEGUARDING_RISK_BACKFILL_INTERVAL_MINUTES,
      lookbackHours: env.SAFEGUARDING_RISK_BACKFILL_LOOKBACK_HOURS,
      sendEmailHooks: env.SAFEGUARDING_RISK_BACKFILL_SEND_EMAIL_HOOKS,
      runOnStartup: env.SAFEGUARDING_RISK_BACKFILL_RUN_ON_STARTUP,
    },
    'Safeguarding risk backfill scheduler started.',
  );

  return () => {
    clearInterval(timer);
  };
}
