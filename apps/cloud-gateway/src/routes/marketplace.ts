// ---------------------------------------------------------------------------
// Marketplace API routes — share and consume API keys
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { CloudEnv } from "../types";
import {
  registerSharedKey,
  getOwnerKeys,
  updateSharedKey,
  deleteSharedKey,
  createListing,
  getActiveListings,
} from "../lib/marketplace";
import {
  getOwnerEarnings,
  getEarningsHistory,
} from "../lib/settlement";

const marketplace = new Hono<CloudEnv>();

// ── Provider endpoints (manage shared keys) ──────────────────────────────

/** Register a new shared API key */
marketplace.post("/keys", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    providerName: string;
    apiKey: string;
    models: string[];
    rateLimitRpm?: number;
    dailyLimit?: number;
  }>();

  if (!body.providerName || !body.apiKey || !body.models?.length) {
    return c.json({ error: { message: "providerName, apiKey, and models are required" } }, 400);
  }

  const key = await registerSharedKey(
    userId,
    body.providerName,
    body.apiKey,
    body.models,
    body.rateLimitRpm,
    body.dailyLimit,
  );

  return c.json({ key });
});

/** List my shared keys */
marketplace.get("/keys", async (c) => {
  const userId = c.get("userId");
  const keys = await getOwnerKeys(userId);
  return c.json({ keys });
});

/** Update a shared key */
marketplace.put("/keys/:id", async (c) => {
  const userId = c.get("userId");
  const keyId = c.req.param("id");
  const body = await c.req.json<{
    rateLimitRpm?: number;
    dailyLimit?: number;
    status?: string;
  }>();

  await updateSharedKey(keyId, userId, body);
  return c.json({ message: "Updated" });
});

/** Delete a shared key */
marketplace.delete("/keys/:id", async (c) => {
  const userId = c.get("userId");
  const keyId = c.req.param("id");
  await deleteSharedKey(keyId, userId);
  return c.json({ message: "Deleted" });
});

/** Create a listing for a shared key */
marketplace.post("/keys/:id/listings", async (c) => {
  const userId = c.get("userId");
  const keyId = c.req.param("id");
  const body = await c.req.json<{
    priceInputPerM: number;
    priceOutputPerM: number;
    description?: string;
  }>();

  if (!body.priceInputPerM || !body.priceOutputPerM) {
    return c.json({ error: { message: "priceInputPerM and priceOutputPerM are required" } }, 400);
  }

  // Verify key ownership and get key details
  const keys = await getOwnerKeys(userId);
  const key = keys.find((k) => k.id === keyId);
  if (!key) {
    return c.json({ error: { message: "Key not found" } }, 404);
  }

  const listing = await createListing(
    keyId,
    userId,
    key.providerName,
    key.models,
    body.priceInputPerM,
    body.priceOutputPerM,
    body.description,
  );

  return c.json({ listing });
});

// ── Consumer endpoints (browse marketplace) ──────────────────────────────

/** Browse available listings */
marketplace.get("/listings", async (c) => {
  const provider = c.req.query("provider");
  const model = c.req.query("model");
  const sort = c.req.query("sort") as "price" | "latency" | "rating" | undefined;

  const listings = await getActiveListings({ provider, model, sort });
  return c.json({ listings });
});

// ── Earnings endpoints ───────────────────────────────────────────────────

/** Get my earnings summary */
marketplace.get("/earnings", async (c) => {
  const userId = c.get("userId");
  const earnings = await getOwnerEarnings(userId);
  return c.json(earnings);
});

/** Get earnings history */
marketplace.get("/earnings/history", async (c) => {
  const userId = c.get("userId");
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "20");

  const result = await getEarningsHistory(userId, page, limit);
  return c.json(result);
});

export default marketplace;
