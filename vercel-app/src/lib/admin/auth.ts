import { timingSafeEqual } from "node:crypto";

/**
 * Server-only check of the owner admin token (env ADMIN_TOKEN).
 * Constant-time comparison; returns false when the env var is unset
 * so the /admin surface simply does not exist in that case.
 */
export function isValidAdminKey(key: string | null | undefined): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token || !key) return false;
  const a = Buffer.from(key, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
