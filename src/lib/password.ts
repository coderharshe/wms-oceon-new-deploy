import bcrypt from "bcryptjs";

// Split out from auth.ts: bcrypt uses Node APIs that aren't available in the
// Edge runtime, and middleware.ts (which runs on Edge) only needs the
// session helpers from auth.ts — keeping bcrypt out of that file keeps it
// out of the middleware bundle entirely.
export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}
