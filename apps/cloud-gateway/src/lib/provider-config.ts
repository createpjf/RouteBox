// ---------------------------------------------------------------------------
// Provider configuration — DB-backed key management + access control
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";
import { log } from "./logger";
import {
  PROVIDER_REGISTRY,
  initCloudProviders,
  type CloudProviderConfig,
} from "./key-pool";

// ---------------------------------------------------------------------------
// Provider Keys CRUD
// ---------------------------------------------------------------------------

export interface ProviderKeyRow {
  id: string;
  providerName: string;
  maskedKey: string;
  baseUrl: string | null;
  label: string | null;
  isActive: boolean;
  createdAt: Date;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return "..." + key.slice(-4);
}

export async function listProviderKeys(): Promise<ProviderKeyRow[]> {
  const rows = await sql`
    SELECT id, provider_name, api_key, base_url, label, is_active, created_at
    FROM provider_keys
    ORDER BY provider_name, created_at
  `;
  return rows.map((r) => ({
    id: r.id as string,
    providerName: r.provider_name as string,
    maskedKey: maskKey(r.api_key as string),
    baseUrl: r.base_url as string | null,
    label: r.label as string | null,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as Date,
  }));
}

export async function createProviderKey(
  providerName: string,
  apiKey: string,
  baseUrl?: string,
  label?: string,
): Promise<ProviderKeyRow> {
  const [row] = await sql`
    INSERT INTO provider_keys (provider_name, api_key, base_url, label)
    VALUES (${providerName}, ${apiKey}, ${baseUrl ?? null}, ${label ?? null})
    RETURNING id, provider_name, api_key, base_url, label, is_active, created_at
  `;
  return {
    id: row.id as string,
    providerName: row.provider_name as string,
    maskedKey: maskKey(row.api_key as string),
    baseUrl: row.base_url as string | null,
    label: row.label as string | null,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as Date,
  };
}

export async function updateProviderKey(
  id: string,
  updates: { apiKey?: string; baseUrl?: string; label?: string; isActive?: boolean },
): Promise<ProviderKeyRow | null> {
  // Build dynamic update
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.apiKey !== undefined) { sets.push("api_key"); vals.push(updates.apiKey); }
  if (updates.baseUrl !== undefined) { sets.push("base_url"); vals.push(updates.baseUrl); }
  if (updates.label !== undefined) { sets.push("label"); vals.push(updates.label); }
  if (updates.isActive !== undefined) { sets.push("is_active"); vals.push(updates.isActive); }

  if (sets.length === 0) return null;

  // Use individual updates to avoid SQL injection with dynamic columns
  if (updates.apiKey !== undefined) {
    await sql`UPDATE provider_keys SET api_key = ${updates.apiKey}, updated_at = now() WHERE id = ${id}`;
  }
  if (updates.baseUrl !== undefined) {
    await sql`UPDATE provider_keys SET base_url = ${updates.baseUrl}, updated_at = now() WHERE id = ${id}`;
  }
  if (updates.label !== undefined) {
    await sql`UPDATE provider_keys SET label = ${updates.label}, updated_at = now() WHERE id = ${id}`;
  }
  if (updates.isActive !== undefined) {
    await sql`UPDATE provider_keys SET is_active = ${updates.isActive}, updated_at = now() WHERE id = ${id}`;
  }

  const [row] = await sql`
    SELECT id, provider_name, api_key, base_url, label, is_active, created_at
    FROM provider_keys WHERE id = ${id}
  `;
  if (!row) return null;

  return {
    id: row.id as string,
    providerName: row.provider_name as string,
    maskedKey: maskKey(row.api_key as string),
    baseUrl: row.base_url as string | null,
    label: row.label as string | null,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as Date,
  };
}

export async function deleteProviderKey(id: string): Promise<void> {
  await sql`DELETE FROM provider_keys WHERE id = ${id}`;
}

// ---------------------------------------------------------------------------
// Load DB keys → CloudProviderConfig[]
// ---------------------------------------------------------------------------

export async function loadDbProviderKeys(): Promise<CloudProviderConfig[]> {
  const rows = await sql`
    SELECT id, provider_name, api_key, base_url
    FROM provider_keys
    WHERE is_active = true
    ORDER BY provider_name, created_at
  `;

  // Build a lookup of provider templates by name
  const templateMap = new Map(PROVIDER_REGISTRY.map((t) => [t.name, t]));

  const configs: CloudProviderConfig[] = [];
  const counterByProvider = new Map<string, number>();

  for (const r of rows) {
    const providerName = r.provider_name as string;
    const tmpl = templateMap.get(providerName);
    if (!tmpl) {
      log.warn("db_key_unknown_provider", { providerName, keyId: r.id });
      continue;
    }

    const idx = counterByProvider.get(providerName) ?? 0;
    counterByProvider.set(providerName, idx + 1);

    configs.push({
      name: providerName,
      baseUrl: (r.base_url as string) || tmpl.defaultBaseUrl,
      apiKey: r.api_key as string,
      prefixes: tmpl.prefixes,
      format: tmpl.format,
      authHeader: tmpl.authHeader,
      instanceId: `${providerName}:db:${idx}`,
    });
  }

  if (configs.length > 0) {
    log.info("db_provider_keys_loaded", { count: configs.length });
  }

  return configs;
}

/** Hot-reload providers from DB + env (called after admin key mutations) */
export async function reloadProviders(): Promise<void> {
  const dbKeys = await loadDbProviderKeys();
  initCloudProviders(dbKeys);
}

// ---------------------------------------------------------------------------
// Provider Access Control
// ---------------------------------------------------------------------------

export interface ProviderAccess {
  providerName: string;
  isEnabled: boolean;
  allowedPlans: string[];
}

let accessCache = new Map<string, ProviderAccess>();

export async function getProviderAccess(): Promise<ProviderAccess[]> {
  const rows = await sql`
    SELECT provider_name, is_enabled, allowed_plans
    FROM provider_access
    ORDER BY provider_name
  `;
  return rows.map((r) => ({
    providerName: r.provider_name as string,
    isEnabled: r.is_enabled as boolean,
    allowedPlans: r.allowed_plans as string[],
  }));
}

export async function setProviderAccess(
  providerName: string,
  isEnabled: boolean,
  allowedPlans: string[],
): Promise<void> {
  await sql`
    INSERT INTO provider_access (provider_name, is_enabled, allowed_plans, updated_at)
    VALUES (${providerName}, ${isEnabled}, ${allowedPlans}, now())
    ON CONFLICT (provider_name) DO UPDATE
    SET is_enabled = ${isEnabled},
        allowed_plans = ${allowedPlans},
        updated_at = now()
  `;
}

export async function ensureProviderAccessDefaults(): Promise<void> {
  const defaultPlans = ["all"];
  for (const tmpl of PROVIDER_REGISTRY) {
    await sql`
      INSERT INTO provider_access (provider_name, is_enabled, allowed_plans)
      VALUES (${tmpl.name}, true, ${defaultPlans})
      ON CONFLICT (provider_name) DO NOTHING
    `;
  }
}

export async function loadProviderAccess(): Promise<void> {
  const rows = await sql`
    SELECT provider_name, is_enabled, allowed_plans
    FROM provider_access
  `;
  const map = new Map<string, ProviderAccess>();
  for (const r of rows) {
    map.set(r.provider_name as string, {
      providerName: r.provider_name as string,
      isEnabled: r.is_enabled as boolean,
      allowedPlans: r.allowed_plans as string[],
    });
  }
  accessCache = map;
  log.info("provider_access_loaded", { count: map.size });
}

/** Check if a provider is allowed for a given user plan */
export function isProviderAllowed(providerName: string, userPlan: string): boolean {
  const access = accessCache.get(providerName);
  if (!access) return true; // unknown provider = allowed
  if (!access.isEnabled) return false; // disabled = blocked for all
  if (access.allowedPlans.includes("all")) return true;
  return access.allowedPlans.includes(userPlan);
}
