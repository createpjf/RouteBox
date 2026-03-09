// ---------------------------------------------------------------------------
// User CRUD — registration, authentication, profile
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";

/** Create a new user with hashed password + initial credits row */
export async function createUser(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ id: string; email: string; displayName: string | null; plan: string; uid: string }> {
  email = email.trim().toLowerCase();

  // Hash password with Bun's built-in bcrypt
  const passwordHash = await Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 12,
  });

  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${email}, ${passwordHash}, ${displayName ?? null})
    RETURNING id, email, display_name, plan, uid
  `;

  // Create credits row
  await sql`
    INSERT INTO credits (user_id, balance_cents) VALUES (${user.id}, 0)
  `;

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    plan: user.plan,
    uid: user.uid,
  };
}

/** Authenticate user by email + password */
export async function authenticateUser(
  email: string,
  password: string,
): Promise<{ id: string; email: string; displayName: string | null; plan: string; uid: string } | null> {
  email = email.trim().toLowerCase();

  const [user] = await sql`
    SELECT id, email, password_hash, display_name, plan, uid
    FROM users WHERE email = ${email}
  `;
  if (!user) return null;

  const valid = await Bun.password.verify(password, user.password_hash);
  if (!valid) return null;

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    plan: user.plan,
    uid: user.uid,
  };
}

/** Get user by ID with balance */
export async function getUserById(id: string) {
  const [row] = await sql`
    SELECT u.id, u.email, u.display_name, u.plan, u.polar_customer_id, u.uid,
           u.created_at, c.balance_cents, c.total_deposited_cents, c.total_used_cents
    FROM users u
    LEFT JOIN credits c ON c.user_id = u.id
    WHERE u.id = ${id}
  `;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    plan: row.plan,
    uid: row.uid,
    polarCustomerId: row.polar_customer_id,
    createdAt: row.created_at,
    balanceCents: row.balance_cents ?? 0,
    totalDepositedCents: row.total_deposited_cents ?? 0,
    totalUsedCents: row.total_used_cents ?? 0,
  };
}

/** Update Polar customer ID */
export async function updatePolarCustomerId(userId: string, customerId: string) {
  await sql`
    UPDATE users SET polar_customer_id = ${customerId}, updated_at = now()
    WHERE id = ${userId}
  `;
}
