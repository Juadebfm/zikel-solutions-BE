import { createHmac } from 'crypto';

const SIGNATURE_VERSION = 'v1';

export function buildWebhookSignature(args: {
  payload: string;
  timestamp: string;
  secret: string;
}) {
  return createHmac('sha256', args.secret)
    .update(`${args.timestamp}.${args.payload}`)
    .digest('hex');
}

export function formatWebhookSignature(signature: string) {
  return `${SIGNATURE_VERSION}=${signature}`;
}

export function parseWebhookSignature(value: string) {
  const [version, signature] = value.split('=', 2);
  if (!version || !signature) {
    return null;
  }
  if (version !== SIGNATURE_VERSION) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return null;
  }
  return { version, signature };
}
