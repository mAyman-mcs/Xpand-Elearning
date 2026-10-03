import bcrypt from "bcryptjs";

// Compared against when the username does not exist, so response time does not reveal valid usernames.
// Computed lazily per cost factor (tests use a low cost).
const dummyHashes = new Map<number, string>();
function dummyHash(cost: number): string {
  let hash = dummyHashes.get(cost);
  if (!hash) {
    hash = bcrypt.hashSync("xpand-timing-equalizer", cost);
    dummyHashes.set(cost, hash);
  }
  return hash;
}

export function hashPassword(plain: string, cost: number): Promise<string> {
  return bcrypt.hash(plain, cost);
}

export async function verifyPassword(plain: string, hash: string | null, cost: number): Promise<boolean> {
  const ok = await bcrypt.compare(plain, hash ?? dummyHash(cost));
  return hash !== null && ok;
}

/** Returns an error message, or null when the password is acceptable. */
export function checkPasswordPolicy(password: string, username: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 128) return "Password must be at most 128 characters.";
  if (password.toLowerCase().includes(username.toLowerCase())) return "Password must not contain your username.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Password must contain letters and numbers.";
  return null;
}
