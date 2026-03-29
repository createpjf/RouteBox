// ---------------------------------------------------------------------------
// Marketplace — shared API key management, listings, and selection
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";
import { encryptApiKey, decryptApiKey, keyHint } from "./key-encryption";
import { log } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SharedKey {
  id: string;
  ownerId: string;
  providerName: string;
  keyHint: string;
  models: string[];
  rateLimitRpm: number;
  dailyLimit: number;
  status: string;
  errorCount: number;
  totalRequests: number;
  totalEarnedCents: number;
  createdAt: string;
}

export interface MarketplaceListing {
  id: string;
  sharedKeyId: string;
  ownerId: string;
  providerName: string;
  models: string[];
  priceInputPerM: number;
  priceOutputPerM: number;
  description: string;
  available: boolean;
  avgLatencyMs: number | null;
  successRate: number;
  totalServed: number;
  ownerDisplayName?: string;
}

// ── Shared Key Management ──────────────────────────────────────────────────

/** Register a new shared API key (encrypted) */
export async function registerSharedKey(
  ownerId: string,
  providerName: string,
  apiKey: string,
  models: string[],
  rateLimitRpm = 60,
  dailyLimit = 1000,
): Promise<SharedKey> {
  const encrypted = await encryptApiKey(apiKey);
  const hint = keyHint(apiKey);

  const [row] = await sql`
    INSERT INTO shared_keys (owner_id, provider_name, api_key_encrypted, key_hint, models, rate_limit_rpm, daily_limit, status)
    VALUES (${ownerId}, ${providerName}, ${encrypted}, ${hint}, ${models}, ${rateLimitRpm}, ${dailyLimit}, 'active')
    RETURNING id, owner_id, provider_name, key_hint, models, rate_limit_rpm, daily_limit, status, error_count, total_requests, total_earned_cents, created_at
  `;

  log.info("marketplace_key_registered", { ownerId, providerName, models });

  return mapSharedKey(row);
}

/** Get all shared keys owned by a user */
export async function getOwnerKeys(ownerId: string): Promise<SharedKey[]> {
  const rows = await sql`
    SELECT id, owner_id, provider_name, key_hint, models, rate_limit_rpm, daily_limit, status, error_count, total_requests, total_earned_cents, created_at
    FROM shared_keys
    WHERE owner_id = ${ownerId}
    ORDER BY created_at DESC
  `;
  return rows.map(mapSharedKey);
}

/** Update shared key settings */
export async function updateSharedKey(
  id: string,
  ownerId: string,
  data: { rateLimitRpm?: number; dailyLimit?: number; status?: string },
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (data.rateLimitRpm !== undefined) { sets.push("rate_limit_rpm"); vals.push(data.rateLimitRpm); }
  if (data.dailyLimit !== undefined) { sets.push("daily_limit"); vals.push(data.dailyLimit); }
  if (data.status !== undefined) { sets.push("status"); vals.push(data.status); }

  if (sets.length === 0) return;

  // Build dynamic update — use parameterized query
  await sql`
    UPDATE shared_keys
    SET
      rate_limit_rpm = COALESCE(${data.rateLimitRpm ?? null}, rate_limit_rpm),
      daily_limit = COALESCE(${data.dailyLimit ?? null}, daily_limit),
      status = COALESCE(${data.status ?? null}, status),
      updated_at = now()
    WHERE id = ${id} AND owner_id = ${ownerId}
  `;
}

/** Delete a shared key and its listings */
export async function deleteSharedKey(id: string, ownerId: string): Promise<void> {
  await sql`DELETE FROM shared_keys WHERE id = ${id} AND owner_id = ${ownerId}`;
  log.info("marketplace_key_deleted", { id, ownerId });
}

/** Decrypt the API key for forwarding */
export async function getDecryptedKey(sharedKeyId: string): Promise<string> {
  const [row] = await sql`
    SELECT api_key_encrypted FROM shared_keys WHERE id = ${sharedKeyId} AND status = 'active'
  `;
  if (!row) throw new Error("Shared key not found or inactive");
  return decryptApiKey(row.api_key_encrypted as string);
}

// ── Listings ───────────────────────────────────────────────────────────────

/** Create a marketplace listing for a shared key */
export async function createListing(
  sharedKeyId: string,
  ownerId: string,
  providerName: string,
  models: string[],
  priceInputPerM: number,
  priceOutputPerM: number,
  description = "",
): Promise<MarketplaceListing> {
  const [row] = await sql`
    INSERT INTO marketplace_listings (shared_key_id, owner_id, provider_name, models, price_input_per_m, price_output_per_m, description)
    VALUES (${sharedKeyId}, ${ownerId}, ${providerName}, ${models}, ${priceInputPerM}, ${priceOutputPerM}, ${description})
    RETURNING *
  `;

  log.info("marketplace_listing_created", { sharedKeyId, ownerId, providerName });
  return mapListing(row);
}

/** Get active listings with optional filters */
export async function getActiveListings(params?: {
  provider?: string;
  model?: string;
  sort?: "price" | "latency" | "rating";
}): Promise<MarketplaceListing[]> {
  const provider = params?.provider;
  const model = params?.model;
  const sort = params?.sort || "price";

  let orderBy: string;
  switch (sort) {
    case "latency":
      orderBy = "ml.avg_latency_ms ASC NULLS LAST";
      break;
    case "rating":
      orderBy = "ml.success_rate DESC";
      break;
    default:
      orderBy = "ml.price_input_per_m ASC";
  }

  // Use conditional WHERE clauses
  const rows = await sql`
    SELECT ml.*, u.display_name as owner_display_name
    FROM marketplace_listings ml
    JOIN users u ON u.id = ml.owner_id
    JOIN shared_keys sk ON sk.id = ml.shared_key_id
    WHERE ml.available = true
      AND sk.status = 'active'
      ${provider ? sql`AND ml.provider_name = ${provider}` : sql``}
      ${model ? sql`AND ${model} = ANY(ml.models)` : sql``}
    ORDER BY ${sql.unsafe(orderBy)}
    LIMIT 50
  `;

  return rows.map(mapListing);
}

/** Get listings that can serve a specific model */
export async function getListingsForModel(model: string): Promise<MarketplaceListing[]> {
  const rows = await sql`
    SELECT ml.*, u.display_name as owner_display_name
    FROM marketplace_listings ml
    JOIN users u ON u.id = ml.owner_id
    JOIN shared_keys sk ON sk.id = ml.shared_key_id
    WHERE ml.available = true
      AND sk.status = 'active'
      AND ${model} = ANY(ml.models)
    ORDER BY ml.price_input_per_m ASC
    LIMIT 10
  `;
  return rows.map(mapListing);
}

/** Update listing stats after a request */
export async function updateListingStats(
  listingId: string,
  latencyMs: number,
  success: boolean,
): Promise<void> {
  await sql`
    UPDATE marketplace_listings
    SET
      total_served = total_served + 1,
      avg_latency_ms = CASE
        WHEN avg_latency_ms IS NULL THEN ${latencyMs}
        ELSE (avg_latency_ms * 0.9 + ${latencyMs} * 0.1)::int
      END,
      success_rate = CASE
        WHEN ${success} THEN LEAST(success_rate + 0.01, 100.00)
        ELSE GREATEST(success_rate - 1.0, 0.00)
      END,
      updated_at = now()
    WHERE id = ${listingId}
  `;
}

/** Record an error on a shared key and potentially disable it */
export async function recordKeyError(sharedKeyId: string, error: string): Promise<void> {
  const [row] = await sql`
    UPDATE shared_keys
    SET error_count = error_count + 1, last_error = ${error}, updated_at = now()
    WHERE id = ${sharedKeyId}
    RETURNING error_count
  `;

  // Auto-disable after 5 consecutive errors
  if (row && (row.error_count as number) >= 5) {
    await sql`
      UPDATE shared_keys SET status = 'disabled', updated_at = now() WHERE id = ${sharedKeyId}
    `;
    await sql`
      UPDATE marketplace_listings SET available = false, updated_at = now() WHERE shared_key_id = ${sharedKeyId}
    `;
    log.warn("marketplace_key_auto_disabled", { sharedKeyId, errorCount: row.error_count });
  }
}

/** Reset error count after a successful request */
export async function resetKeyErrors(sharedKeyId: string): Promise<void> {
  await sql`
    UPDATE shared_keys
    SET error_count = 0, last_error = null, last_used_at = now(), total_requests = total_requests + 1, updated_at = now()
    WHERE id = ${sharedKeyId}
  `;
}

// ── Mappers ────────────────────────────────────────────────────────────────

function mapSharedKey(row: Record<string, unknown>): SharedKey {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    providerName: row.provider_name as string,
    keyHint: row.key_hint as string,
    models: row.models as string[],
    rateLimitRpm: row.rate_limit_rpm as number,
    dailyLimit: row.daily_limit as number,
    status: row.status as string,
    errorCount: row.error_count as number,
    totalRequests: row.total_requests as number,
    totalEarnedCents: row.total_earned_cents as number,
    createdAt: String(row.created_at),
  };
}

function mapListing(row: Record<string, unknown>): MarketplaceListing {
  return {
    id: row.id as string,
    sharedKeyId: row.shared_key_id as string,
    ownerId: row.owner_id as string,
    providerName: row.provider_name as string,
    models: row.models as string[],
    priceInputPerM: Number(row.price_input_per_m),
    priceOutputPerM: Number(row.price_output_per_m),
    description: (row.description as string) || "",
    available: row.available as boolean,
    avgLatencyMs: row.avg_latency_ms as number | null,
    successRate: Number(row.success_rate),
    totalServed: row.total_served as number,
    ownerDisplayName: row.owner_display_name as string | undefined,
  };
}
