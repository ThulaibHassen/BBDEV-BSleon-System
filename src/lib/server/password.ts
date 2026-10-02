import 'server-only';
import { hash, verify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';

/* argon2id with OWASP-recommended parameters (19 MiB, 2 passes). */
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const hashPassword = (pw: string) => hash(pw, OPTS);

export async function verifyPassword(stored: string | null | undefined, pw: string) {
  if (!stored) {
    // burn comparable time so "no such user" and "wrong password" look alike
    await hash(pw, OPTS);
    return false;
  }
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Mix letters and numbers.';
  return null;
}

/* One-time sign-in codes for students and parents: 6 digits with no leading
   zero (100000–999999), so a code never loses a digit when pasted into a
   number field. Shown once, stored only as a hash. */
export function newCode() {
  return String(randomInt(100000, 1000000));
}
