import { createHash, randomBytes, randomInt } from "node:crypto";

/** 256-bit opaque token, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored hashed so a database leak does not expose live sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Human-typable temporary password for imported accounts (no ambiguous characters). */
export function tempPassword(length = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}
