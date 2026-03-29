// ---------------------------------------------------------------------------
// AES-256-GCM encryption for marketplace shared API keys
// ---------------------------------------------------------------------------

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

function getEncryptionKey(): string {
  const key = process.env.MARKETPLACE_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error("MARKETPLACE_ENCRYPTION_KEY must be set (min 32 chars)");
  }
  return key;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret.slice(0, 32).padEnd(32, "0"));
  return crypto.subtle.importKey("raw", keyData, { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt a plaintext API key → base64(iv:ciphertext:tag) */
export async function encryptApiKey(plaintext: string): Promise<string> {
  const key = await deriveKey(getEncryptionKey());
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data,
  );

  // Combine iv + ciphertext (which includes tag in WebCrypto)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/** Decrypt a base64-encoded encrypted API key */
export async function decryptApiKey(encrypted: string): Promise<string> {
  const key = await deriveKey(getEncryptionKey());
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

/** Generate a hint like "sk-...abc" from a full API key */
export function keyHint(apiKey: string): string {
  const prefix = apiKey.slice(0, 5);
  const suffix = apiKey.slice(-3);
  return `${prefix}...${suffix}`;
}
