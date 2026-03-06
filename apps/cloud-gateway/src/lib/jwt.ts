// ---------------------------------------------------------------------------
// JWT signing + verification (using jose — lightweight, no Node.js crypto dep)
// ---------------------------------------------------------------------------

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

// env.ts validateEnv() ensures JWT_SECRET is set and sufficiently long
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

export interface TokenPayload extends JWTPayload {
  sub: string;
  email: string;
}

export async function signToken(
  userId: string,
  email: string,
): Promise<string> {
  return new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .setIssuer("routebox-cloud")
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET, {
    issuer: "routebox-cloud",
  });
  return payload as TokenPayload;
}
