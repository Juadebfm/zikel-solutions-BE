/**
 * Lightweight in-memory cache for hot data that rarely changes.
 *
 * Uses lru-cache with TTL-based eviction. Suitable for a single-instance
 * deployment. If you scale to multiple instances,
 * replace with Redis or add a pub/sub invalidation layer.
 */
import { LRUCache } from 'lru-cache';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

// ─── Cache instances ────────────────────────────────────────────────────────

/** Tenant roles cache: keyed by `tenantId`. TTL 5 minutes. */
const rolesCache = new LRUCache<string, RoleCacheEntry[]>({
  max: 200, // up to 200 tenants cached
  ttl: 5 * 60 * 1000,
});

/** Tenant settings cache: keyed by `tenantId`. TTL 5 minutes. */
const settingsCache = new LRUCache<string, SettingsCacheEntry>({
  max: 200,
  ttl: 5 * 60 * 1000,
});

/** Form templates cache: single global key. TTL 10 minutes (templates change rarely). */
const formTemplatesCache = new LRUCache<string, FormTemplateCacheEntry[]>({
  max: 1,
  ttl: 10 * 60 * 1000,
});

// ─── Types ──────────────────────────────────────────────────────────────────

type RoleCacheEntry = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isSystemGenerated: boolean;
  permissions: unknown;
};

type SettingsCacheEntry = {
  tenantId: string;
  timezone: string;
  locale: string;
  dateFormat: string;
  logoUrl: string | null;
  sessionTimeout: number | null;
  mfaRequired: boolean;
  dataRetentionDays: number | null;
};

type FormTemplateCacheEntry = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  group: string | null;
  isActive: boolean;
};

// ─── Cached lookups ─────────────────────────────────────────────────────────

/**
 * Get roles for a tenant. Returns from cache if available, otherwise fetches
 * from DB and caches the result.
 */
export async function getCachedRoles(tenantId: string): Promise<RoleCacheEntry[]> {
  const cached = rolesCache.get(tenantId);
  if (cached) return cached;

  try {
    const roles = await prisma.role.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        isSystemGenerated: true,
        permissions: true,
      },
      orderBy: { name: 'asc' },
    });
    rolesCache.set(tenantId, roles);
    return roles;
  } catch (error) {
    logger.warn({ msg: 'Failed to fetch roles for cache', tenantId, error });
    return [];
  }
}

/**
 * Get tenant settings. Returns from cache if available.
 */
export async function getCachedSettings(tenantId: string): Promise<SettingsCacheEntry | null> {
  const cached = settingsCache.get(tenantId);
  if (cached) return cached;

  try {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        tenantId: true,
        timezone: true,
        locale: true,
        dateFormat: true,
        logoUrl: true,
        sessionTimeout: true,
        mfaRequired: true,
        dataRetentionDays: true,
      },
    });
    if (settings) {
      settingsCache.set(tenantId, settings);
    }
    return settings;
  } catch (error) {
    logger.warn({ msg: 'Failed to fetch settings for cache', tenantId, error });
    return null;
  }
}

/**
 * Get all active form template metadata (no schemaJson — just the catalog).
 * This is the same for all tenants since FormTemplate is a global model.
 */
export async function getCachedFormTemplates(): Promise<FormTemplateCacheEntry[]> {
  const CACHE_KEY = 'global';
  const cached = formTemplatesCache.get(CACHE_KEY);
  if (cached) return cached;

  try {
    const templates = await prisma.formTemplate.findMany({
      where: { isActive: true },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        group: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
    formTemplatesCache.set(CACHE_KEY, templates);
    return templates;
  } catch (error) {
    logger.warn({ msg: 'Failed to fetch form templates for cache', error });
    return [];
  }
}

// ─── Invalidation ───────────────────────────────────────────────────────────

/** Call after a role is created, updated, or deleted. */
export function invalidateRolesCache(tenantId: string) {
  rolesCache.delete(tenantId);
}

/** Call after tenant settings are updated. */
export function invalidateSettingsCache(tenantId: string) {
  settingsCache.delete(tenantId);
}

/** Call after a form template is created, updated, or deleted. */
export function invalidateFormTemplatesCache() {
  formTemplatesCache.clear();
}

/** Clear everything — useful for tests. */
export function clearAllCaches() {
  rolesCache.clear();
  settingsCache.clear();
  formTemplatesCache.clear();
}
