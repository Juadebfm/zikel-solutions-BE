import { randomUUID } from 'crypto';
import { extname } from 'path';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadPurpose } from '@prisma/client';
import { env } from '../config/env.js';
import { httpError } from './errors.js';

const FILE_NAME_SAFE_RE = /[^a-zA-Z0-9._-]+/g;

let s3Client: S3Client | null = null;
let allowedMimeTypes: Set<string> | null = null;

function getAllowedMimeTypes() {
  if (allowedMimeTypes) return allowedMimeTypes;
  const list = env.UPLOADS_ALLOWED_MIME_TYPES
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  allowedMimeTypes = new Set(list);
  return allowedMimeTypes;
}

function getS3Client() {
  if (s3Client) return s3Client;

  const config: S3ClientConfig = {
    region: env.UPLOADS_S3_REGION,
    forcePathStyle: env.UPLOADS_FORCE_PATH_STYLE,
  };

  if (env.UPLOADS_S3_ENDPOINT) {
    config.endpoint = env.UPLOADS_S3_ENDPOINT;
  }

  if (env.UPLOADS_S3_ACCESS_KEY_ID && env.UPLOADS_S3_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: env.UPLOADS_S3_ACCESS_KEY_ID,
      secretAccessKey: env.UPLOADS_S3_SECRET_ACCESS_KEY,
    };
  }

  s3Client = new S3Client(config);

  return s3Client;
}

export function assertUploadsEnabled() {
  if (!env.UPLOADS_ENABLED) {
    throw httpError(503, 'UPLOADS_DISABLED', 'File uploads are disabled on this environment.');
  }

  if (!env.UPLOADS_S3_BUCKET) {
    throw httpError(500, 'UPLOADS_CONFIG_INVALID', 'Uploads storage bucket is not configured.');
  }
}

function normalizeFileName(input: string) {
  const trimmed = input.trim();
  const safe = trimmed.replace(FILE_NAME_SAFE_RE, '_').replace(/_{2,}/g, '_').slice(0, 180);
  if (!safe) return `file-${randomUUID()}`;
  return safe;
}

export function buildStorageKey(args: {
  tenantId: string;
  purpose: UploadPurpose;
  fileName: string;
}) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeName = normalizeFileName(args.fileName);
  return `tenants/${args.tenantId}/${args.purpose}/${year}/${month}/${Date.now()}-${randomUUID()}-${safeName}`;
}

export function validateUploadInput(args: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}) {
  if (!args.fileName.trim()) {
    throw httpError(422, 'VALIDATION_ERROR', 'File name is required.');
  }

  if (args.sizeBytes <= 0) {
    throw httpError(422, 'VALIDATION_ERROR', 'File size must be greater than zero.');
  }

  if (args.sizeBytes > env.UPLOADS_MAX_FILE_SIZE_BYTES) {
    throw httpError(
      422,
      'FILE_TOO_LARGE',
      `File exceeds max size of ${env.UPLOADS_MAX_FILE_SIZE_BYTES} bytes.`,
    );
  }

  const normalizedMime = args.contentType.trim().toLowerCase();
  const allowed = getAllowedMimeTypes();
  if (allowed.size > 0 && !allowed.has(normalizedMime)) {
    throw httpError(422, 'UNSUPPORTED_FILE_TYPE', `File type ${normalizedMime} is not allowed.`);
  }
}

export function getFileExtension(fileName: string) {
  const ext = extname(fileName).toLowerCase();
  if (!ext) return null;
  return ext;
}

export async function createSignedUploadUrl(args: {
  key: string;
  contentType: string;
  checksumSha256?: string | null;
}) {
  assertUploadsEnabled();
  const bucket = env.UPLOADS_S3_BUCKET as string;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: args.key,
    ContentType: args.contentType,
    Metadata: args.checksumSha256 ? { checksumsha256: args.checksumSha256 } : undefined,
  });

  return getSignedUrl(getS3Client(), command, {
    expiresIn: env.UPLOADS_SIGNED_URL_TTL_SECONDS,
  });
}

export async function createSignedDownloadUrl(key: string) {
  assertUploadsEnabled();
  const bucket = env.UPLOADS_S3_BUCKET as string;
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });

  return getSignedUrl(getS3Client(), command, {
    expiresIn: env.UPLOADS_SIGNED_URL_TTL_SECONDS,
  });
}

export async function headUploadedObject(key: string) {
  assertUploadsEnabled();
  const bucket = env.UPLOADS_S3_BUCKET as string;
  const response = await getS3Client().send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );

  return {
    etag: response.ETag ?? null,
    contentLength: response.ContentLength ?? null,
    contentType: response.ContentType ?? null,
  };
}

export function maybeBuildPublicFileUrl(key: string) {
  if (!env.UPLOADS_PUBLIC_BASE_URL) return null;
  const normalizedBase = env.UPLOADS_PUBLIC_BASE_URL.replace(/\/+$/, '');
  const encodedParts = key.split('/').map((segment) => encodeURIComponent(segment));
  return `${normalizedBase}/${encodedParts.join('/')}`;
}
