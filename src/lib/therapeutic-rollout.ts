import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from '../types/index.js';
import { env } from '../config/env.js';
import { httpError } from './errors.js';
import { logger } from './logger.js';
import { requireTenantContext } from './tenant-context.js';

export type TherapeuticModuleFlag =
  | 'reg_packs'
  | 'chronology'
  | 'risk_alerts'
  | 'patterns'
  | 'ri_dashboard'
  | 'reflective_prompts';

export type TherapeuticRouteConfig = {
  therapeuticModule?: TherapeuticModuleFlag;
  therapeuticAction?: string;
  therapeuticActionCompletion?: boolean;
};

type TherapeuticTelemetryState = {
  module: TherapeuticModuleFlag;
  action: string;
  userId: string;
  tenantId: string | null;
  startedAtMs: number;
  actionCompletionCount: number;
  alertVolumeCount: number;
};

const requestTelemetryState = new WeakMap<FastifyRequest, TherapeuticTelemetryState>();

function parseCsvSet(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function isFeatureEnabled(module: TherapeuticModuleFlag): boolean {
  switch (module) {
    case 'reg_packs':
      return env.THERAPEUTIC_REG_PACKS_ENABLED;
    case 'chronology':
      return env.THERAPEUTIC_CHRONOLOGY_ENABLED;
    case 'risk_alerts':
      return env.THERAPEUTIC_RISK_ALERTS_ENABLED;
    case 'patterns':
      return env.THERAPEUTIC_PATTERNS_ENABLED;
    case 'ri_dashboard':
      return env.THERAPEUTIC_RI_DASHBOARD_ENABLED;
    case 'reflective_prompts':
      return env.THERAPEUTIC_REFLECTIVE_PROMPTS_ENABLED;
    default:
      return false;
  }
}

export function readTherapeuticRouteConfig(request: FastifyRequest): TherapeuticRouteConfig | null {
  const raw = request.routeOptions.config as unknown as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;

  const module = raw.therapeuticModule;
  const action = raw.therapeuticAction;
  const actionCompletion = raw.therapeuticActionCompletion;

  if (
    module !== 'reg_packs'
    && module !== 'chronology'
    && module !== 'risk_alerts'
    && module !== 'patterns'
    && module !== 'ri_dashboard'
    && module !== 'reflective_prompts'
  ) {
    return null;
  }

  const config: TherapeuticRouteConfig = {
    therapeuticModule: module,
    therapeuticActionCompletion: actionCompletion === true,
  };
  if (typeof action === 'string' && action.trim().length > 0) {
    config.therapeuticAction = action;
  }
  return config;
}

export async function enforceTherapeuticRouteAccess(
  request: FastifyRequest,
  config: TherapeuticRouteConfig,
) {
  const module = config.therapeuticModule;
  if (!module) return;

  const jwt = request.user as JwtPayload | undefined;
  const userId = jwt?.sub;
  if (!userId) {
    throw httpError(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  let tenantId = jwt?.tenantId ?? null;
  requestTelemetryState.set(request, {
    module,
    action: config.therapeuticAction ?? `${request.method} ${request.routeOptions.url}`,
    userId,
    tenantId,
    startedAtMs: Date.now(),
    actionCompletionCount: 0,
    alertVolumeCount: 0,
  });

  if (!isFeatureEnabled(module)) {
    throw httpError(
      503,
      'THERAPEUTIC_MODULE_DISABLED',
      `Therapeutic module "${module}" is currently disabled.`,
    );
  }

  if (env.THERAPEUTIC_PILOT_MODE_ENABLED) {
    if (!tenantId) {
      const tenant = await requireTenantContext(userId);
      tenantId = tenant.tenantId;
      const state = requestTelemetryState.get(request);
      if (state) {
        state.tenantId = tenantId;
        requestTelemetryState.set(request, state);
      }
    }

    const allowedTenants = parseCsvSet(env.THERAPEUTIC_PILOT_TENANT_IDS);
    if (!tenantId || !allowedTenants.has(tenantId)) {
      throw httpError(
        403,
        'THERAPEUTIC_MODULE_NOT_ENABLED_FOR_TENANT',
        'This therapeutic module is not enabled for this tenant yet.',
      );
    }
  }
}

export function addTherapeuticTelemetryMetrics(
  request: FastifyRequest,
  metrics: {
    actionCompletionCount?: number;
    alertVolumeCount?: number;
  },
) {
  const current = requestTelemetryState.get(request);
  if (!current) return;

  if (typeof metrics.actionCompletionCount === 'number' && Number.isFinite(metrics.actionCompletionCount)) {
    current.actionCompletionCount += metrics.actionCompletionCount;
  }
  if (typeof metrics.alertVolumeCount === 'number' && Number.isFinite(metrics.alertVolumeCount)) {
    current.alertVolumeCount += metrics.alertVolumeCount;
  }

  requestTelemetryState.set(request, current);
}

export function emitTherapeuticRouteTelemetry(
  request: FastifyRequest,
  args: {
    statusCode: number;
    config: TherapeuticRouteConfig;
  },
) {
  const current = requestTelemetryState.get(request);
  if (!current) return;
  requestTelemetryState.delete(request);

  if (!env.THERAPEUTIC_TELEMETRY_ENABLED) return;

  const latencyMs = Math.max(0, Date.now() - current.startedAtMs);
  const success = args.statusCode < 400;
  const actionCompletionCount =
    success && args.config.therapeuticActionCompletion
      ? Math.max(1, current.actionCompletionCount)
      : current.actionCompletionCount;

  logger.info(
    {
      category: 'therapeutic_rollout_telemetry',
      module: current.module,
      action: current.action,
      tenantId: current.tenantId,
      userId: current.userId,
      statusCode: args.statusCode,
      success,
      usageCount: 1,
      failureCount: success ? 0 : 1,
      latencyMs,
      alertVolumeCount: current.alertVolumeCount,
      actionCompletionCount,
      pilotModeEnabled: env.THERAPEUTIC_PILOT_MODE_ENABLED,
      rolloutWave: env.THERAPEUTIC_ROLLOUT_WAVE_LABEL,
      timestamp: new Date().toISOString(),
    },
    'Therapeutic rollout telemetry.',
  );
}
