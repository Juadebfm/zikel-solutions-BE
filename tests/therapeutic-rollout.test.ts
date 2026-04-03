import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const {
  env,
  requireTenantContext,
  loggerInfo,
} = vi.hoisted(() => ({
  env: {
    THERAPEUTIC_REG_PACKS_ENABLED: true,
    THERAPEUTIC_CHRONOLOGY_ENABLED: true,
    THERAPEUTIC_RISK_ALERTS_ENABLED: true,
    THERAPEUTIC_PATTERNS_ENABLED: true,
    THERAPEUTIC_RI_DASHBOARD_ENABLED: true,
    THERAPEUTIC_REFLECTIVE_PROMPTS_ENABLED: true,
    THERAPEUTIC_PILOT_MODE_ENABLED: false,
    THERAPEUTIC_PILOT_TENANT_IDS: '',
    THERAPEUTIC_TELEMETRY_ENABLED: true,
    THERAPEUTIC_ROLLOUT_WAVE_LABEL: 'wave_1_internal',
  },
  requireTenantContext: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('../src/config/env.js', () => ({ env }));
vi.mock('../src/lib/tenant-context.js', () => ({ requireTenantContext }));
vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: loggerInfo,
  },
}));

import {
  addTherapeuticTelemetryMetrics,
  emitTherapeuticRouteTelemetry,
  enforceTherapeuticRouteAccess,
  readTherapeuticRouteConfig,
} from '../src/lib/therapeutic-rollout.js';

function buildRequest(args: {
  module: string;
  action?: string;
  userId?: string;
  tenantId?: string | null;
}): FastifyRequest {
  return {
    method: 'GET',
    user: {
      sub: args.userId ?? 'user_1',
      role: 'admin',
      tenantRole: 'tenant_admin',
      tenantId: args.tenantId ?? null,
    },
    routeOptions: {
      url: '/api/v1/test',
      config: {
        therapeuticModule: args.module,
        therapeuticAction: args.action ?? 'test_action',
      },
    },
  } as unknown as FastifyRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  env.THERAPEUTIC_REG_PACKS_ENABLED = true;
  env.THERAPEUTIC_CHRONOLOGY_ENABLED = true;
  env.THERAPEUTIC_RISK_ALERTS_ENABLED = true;
  env.THERAPEUTIC_PATTERNS_ENABLED = true;
  env.THERAPEUTIC_RI_DASHBOARD_ENABLED = true;
  env.THERAPEUTIC_REFLECTIVE_PROMPTS_ENABLED = true;
  env.THERAPEUTIC_PILOT_MODE_ENABLED = false;
  env.THERAPEUTIC_PILOT_TENANT_IDS = '';
  env.THERAPEUTIC_TELEMETRY_ENABLED = true;
  env.THERAPEUTIC_ROLLOUT_WAVE_LABEL = 'wave_1_internal';
  requireTenantContext.mockResolvedValue({
    tenantId: 'tenant_internal',
  });
});

describe('therapeutic rollout helper', () => {
  it('returns null config for non-therapeutic routes', () => {
    const request = {
      routeOptions: { config: {} },
    } as unknown as FastifyRequest;
    expect(readTherapeuticRouteConfig(request)).toBeNull();
  });

  it('blocks access when module feature flag is disabled', async () => {
    env.THERAPEUTIC_REG_PACKS_ENABLED = false;
    const request = buildRequest({ module: 'reg_packs', tenantId: 'tenant_internal' });
    const config = readTherapeuticRouteConfig(request);
    expect(config).not.toBeNull();

    await expect(enforceTherapeuticRouteAccess(request, config!)).rejects.toMatchObject({
      statusCode: 503,
      code: 'THERAPEUTIC_MODULE_DISABLED',
    });
  });

  it('enforces pilot allowlist when pilot mode is enabled', async () => {
    env.THERAPEUTIC_PILOT_MODE_ENABLED = true;
    env.THERAPEUTIC_PILOT_TENANT_IDS = 'tenant_internal';

    const blockedRequest = buildRequest({
      module: 'chronology',
      tenantId: 'tenant_external',
    });
    const blockedConfig = readTherapeuticRouteConfig(blockedRequest);
    await expect(
      enforceTherapeuticRouteAccess(blockedRequest, blockedConfig!),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'THERAPEUTIC_MODULE_NOT_ENABLED_FOR_TENANT',
    });

    const allowedRequest = buildRequest({
      module: 'chronology',
      tenantId: 'tenant_internal',
    });
    const allowedConfig = readTherapeuticRouteConfig(allowedRequest);
    await expect(
      enforceTherapeuticRouteAccess(allowedRequest, allowedConfig!),
    ).resolves.toBeUndefined();
  });

  it('emits structured telemetry with usage/latency/failure and metric counters', async () => {
    const request = buildRequest({
      module: 'risk_alerts',
      tenantId: 'tenant_internal',
      action: 'risk_alerts_evaluate',
    });
    const config = readTherapeuticRouteConfig(request);
    expect(config).not.toBeNull();

    await enforceTherapeuticRouteAccess(request, config!);
    addTherapeuticTelemetryMetrics(request, {
      alertVolumeCount: 5,
      actionCompletionCount: 2,
    });
    emitTherapeuticRouteTelemetry(request, {
      statusCode: 200,
      config: {
        ...config!,
        therapeuticActionCompletion: true,
      },
    });

    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'therapeutic_rollout_telemetry',
        module: 'risk_alerts',
        action: 'risk_alerts_evaluate',
        success: true,
        usageCount: 1,
        failureCount: 0,
        alertVolumeCount: 5,
        actionCompletionCount: 2,
      }),
      'Therapeutic rollout telemetry.',
    );
  });
});
