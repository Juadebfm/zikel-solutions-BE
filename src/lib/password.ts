import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;
const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

const TIMING_NORMALIZATION_BCRYPT_HASH = '$2a$12$invalidhashfortimingnormalisati';

export async function hashPassword(plainTextPassword: string) {
  return argon2.hash(plainTextPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(plainTextPassword: string, storedHash: string) {
  if (storedHash.startsWith('$argon2id$')) {
    const match = await argon2.verify(storedHash, plainTextPassword);
    const needsRehash = match ? await argon2.needsRehash(storedHash, ARGON2_OPTIONS) : false;
    return { match, algorithm: 'argon2id' as const, needsRehash };
  }

  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    const match = await bcrypt.compare(plainTextPassword, storedHash);
    return { match, algorithm: 'bcrypt' as const, needsRehash: match };
  }

  await bcrypt.compare(plainTextPassword, TIMING_NORMALIZATION_BCRYPT_HASH);
  return { match: false, algorithm: 'unknown' as const, needsRehash: false };
}

export async function normalizePasswordCheckTiming(plainTextPassword: string) {
  await bcrypt.compare(plainTextPassword, TIMING_NORMALIZATION_BCRYPT_HASH);
}

export { BCRYPT_COST };
