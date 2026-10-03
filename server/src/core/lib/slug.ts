/**
 * "Cloud Security / 101" → "cloud-security-101". Matches the slug CHECK constraints in the database.
 * Returns "" for names without Latin letters or digits (e.g. Arabic); callers supply a fallback.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // drop accents split off by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
