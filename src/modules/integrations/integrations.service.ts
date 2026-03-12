import type { IngestSecurityAlertBody } from './integrations.schema.js';
import { logger } from '../../lib/logger.js';

type ReceiveSecurityAlertMeta = {
  requestId: string;
  sourceHeader: string | null;
};

export async function receiveSecurityAlertWebhook(
  payload: IngestSecurityAlertBody,
  meta: ReceiveSecurityAlertMeta,
) {
  logger.info({
    msg: 'Security alert webhook received.',
    requestId: meta.requestId,
    sourceHeader: meta.sourceHeader,
    deliveryId: payload.deliveryId,
    alertType: payload.alert.type,
    severity: payload.alert.severity,
    auditLogId: payload.source.auditLogId,
    action: payload.source.action,
    entityType: payload.source.entityType,
    tenantId: payload.source.tenantId,
  });

  return {
    accepted: true,
    deliveryId: payload.deliveryId,
  };
}
