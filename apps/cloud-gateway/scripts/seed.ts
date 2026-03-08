#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Seed script — bootstrap admin user for API testing
// Usage: bun run scripts/seed.ts
//
// What it does:
//   1. Finds the admin user (from ADMIN_EMAILS env var)
//   2. Adds $10 credits (1000 cents) if balance < $0.50
//   3. Creates an API key (rb_...) if none exist
//   4. Prints the API key and a curl test command
// ---------------------------------------------------------------------------

import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://routebox:routebox@localhost:5432/routebox";

const sql = postgres(DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === "true" ? "require" : false,
});

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

if (ADMIN_EMAILS.length === 0) {
  console.error("Error: ADMIN_EMAILS env var is empty. Set it in .env");
  process.exit(1);
}

const adminEmail = ADMIN_EMAILS[0];
console.log(`Looking up admin user: ${adminEmail}`);

// 1. Find admin user
const [user] = await sql`SELECT id, email, plan FROM users WHERE email = ${adminEmail}`;
if (!user) {
  console.error(`Error: No user found with email ${adminEmail}. Register first.`);
  await sql.end();
  process.exit(1);
}

const userId = user.id as string;
console.log(`Found user: ${userId} (plan: ${user.plan})`);

// 2. Check balance and top up if needed
const [credits] = await sql`
  SELECT balance_cents, bonus_cents FROM credits WHERE user_id = ${userId}
`;
const currentBalance = (credits?.balance_cents ?? 0) as number;
const currentBonus = (credits?.bonus_cents ?? 0) as number;
const total = currentBalance + currentBonus;

console.log(`Current balance: $${(currentBalance / 100).toFixed(2)} + $${(currentBonus / 100).toFixed(2)} bonus = $${(total / 100).toFixed(2)} total`);

if (total < 50) {
  // Add $10 (1000 cents)
  const addCents = 1000;

  if (!credits) {
    // Create credits row
    await sql`
      INSERT INTO credits (user_id, balance_cents, bonus_cents, total_deposited_cents, total_used_cents)
      VALUES (${userId}, ${addCents}, 0, ${addCents}, 0)
    `;
  } else {
    await sql`
      UPDATE credits
      SET balance_cents = balance_cents + ${addCents},
          total_deposited_cents = total_deposited_cents + ${addCents}
      WHERE user_id = ${userId}
    `;
  }

  // Record transaction
  await sql`
    INSERT INTO transactions (user_id, type, amount_cents, description)
    VALUES (${userId}, 'admin_credit', ${addCents}, 'Seed: initial admin credits')
  `;

  console.log(`Added $${(addCents / 100).toFixed(2)} credits. New balance: $${((currentBalance + addCents) / 100).toFixed(2)}`);
} else {
  console.log("Balance is sufficient, skipping top-up.");
}

// 3. Check for existing API keys
const existingKeys = await sql`
  SELECT id, key_prefix FROM api_keys
  WHERE user_id = ${userId} AND is_active = true
`;

let apiKey: string;

if (existingKeys.length > 0) {
  console.log(`Existing API key found: ${existingKeys[0].key_prefix}...`);
  console.log("(Cannot show full key — it was only available at creation time)");
  console.log("Creating a new key for this session...");
}

// Generate new API key
const randomBytes = crypto.getRandomValues(new Uint8Array(16));
const keyHex = Array.from(randomBytes)
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
apiKey = `rb_${keyHex}`;

// Hash it
const hashBuffer = await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(apiKey),
);
const keyHash = Array.from(new Uint8Array(hashBuffer))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
const keyPrefix = apiKey.substring(0, 12);

await sql`
  INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
  VALUES (${userId}, ${keyHash}, ${keyPrefix}, 'Seed key')
`;

console.log("");
console.log("=".repeat(60));
console.log("API Key created (save this — it cannot be retrieved again):");
console.log(`  ${apiKey}`);
console.log("=".repeat(60));
console.log("");
console.log("Test with:");
console.log(`curl http://localhost:3001/v1/chat/completions \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -H "Authorization: Bearer ${apiKey}" \\`);
console.log(`  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"hello"}]}'`);

await sql.end();
