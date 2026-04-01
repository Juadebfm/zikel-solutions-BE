import { prisma } from './prisma.js';
import { logger } from './logger.js';
import { buildWebhookSignature, formatWebhookSignature } from './webhook-signature.js';

const DEFAULT_TIMEOUT_MS = 10_000;

const BACKOFF_DELAYS_MS = [
  0,          // attempt 1: immediate
  60_000,     // attempt 2: 1 minute
  300_000,    // attempt 3: 5 minutes
  1_800_000,  // attempt 4: 30 minutes
];
const MAX_ATTEMPTS = BACKOFF_DELAYS_MS.length + 1;

async function dispatchHttp(args: {
  url: string;
  payload: Record<string, unknown>;
  secret: string;
  eventType: string;
  timeoutMs?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const payloadBody = JSON.stringify(args.payload);
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = buildWebhookSignature({
      payload: payloadBody,
      timestamp,
      secret: args.secret,
    });

    const response = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Zikel-Webhook-Timestamp': timestamp,
        'X-Zikel-Webhook-Signature': formatWebhookSignature(signature),
        'X-Zikel-Event-Type': args.eventType,
      },
      body: payloadBody,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `Webhook responded with status ${response.status}.` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown dispatch error.';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function queueWebhookDelivery(args: {
  endpointId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const delivery = await prisma.webhookDelivery.create({
    data: {
      endpointId: args.endpointId,
      eventType: args.eventType,
      payload: args.payload,
      status: 'pending',
    },
  });

  // Fire-and-forget dispatch
  void dispatchDelivery(delivery.id).catch((err) => {
    logger.error({ err, deliveryId: delivery.id }, 'Failed initial webhook dispatch.');
  });

  return delivery;
}

async function dispatchDelivery(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: { select: { url: true, secret: true, isActive: true } } },
  });

  if (!delivery || !delivery.endpoint.isActive) return;

  const result = await dispatchHttp({
    url: delivery.endpoint.url,
    payload: delivery.payload as Record<string, unknown>,
    secret: delivery.endpoint.secret,
    eventType: delivery.eventType,
  });

  const attemptCount = delivery.attemptCount + 1;

  if (result.ok) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'delivered', attemptCount, dispatchedAt: new Date(), lastError: null },
    });
  } else {
    const isFinal = attemptCount >= MAX_ATTEMPTS;
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: isFinal ? 'failed' : 'pending',
        attemptCount,
        lastError: result.error,
      },
    });
  }
}

export async function dispatchQueuedWebhooks(limit = 50) {
  const pending = await prisma.webhookDelivery.findMany({
    where: { status: 'pending', attemptCount: { gt: 0, lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, attemptCount: true, updatedAt: true },
  });

  let dispatched = 0;
  for (const delivery of pending) {
    const delayMs = BACKOFF_DELAYS_MS[delivery.attemptCount - 1] ?? 0;
    const readyAt = new Date(delivery.updatedAt.getTime() + delayMs);
    if (new Date() < readyAt) continue;

    await dispatchDelivery(delivery.id);
    dispatched += 1;
  }

  return { dispatched, checked: pending.length };
}

export async function emitWebhookEvent(args: {
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { tenantId: args.tenantId, isActive: true, events: { has: args.eventType } },
    select: { id: true },
  });

  for (const endpoint of endpoints) {
    await queueWebhookDelivery({
      endpointId: endpoint.id,
      eventType: args.eventType,
      payload: { event: args.eventType, ...args.payload, emittedAt: new Date().toISOString() },
    });
  }
}
