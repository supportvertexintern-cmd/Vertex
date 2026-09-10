import bcrypt from "bcryptjs";
import crypto from "crypto";

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Admin-provisioned accounts (staff, partners) get a system-generated
// temporary password rather than choosing their own — returned once in
// the API response, never stored or logged in plaintext.
export function generateTemporaryPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
