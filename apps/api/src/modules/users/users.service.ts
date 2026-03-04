import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';
import { ValidationError } from '../../shared/errors';

// Path to the avatar collection directory of the web app.
// Can be overridden via the AVATARS_DIR env var when deploying to production.
//
// Path resolution logic (monorepo structure):
//   users.service.ts  →  apps/api/src/modules/users/
//   5 levels up       →  engram_spira/ (root)
//   + apps/web/public/ava_colect
const AVATARS_DIR =
  process.env.AVATARS_DIR ??
  resolve(import.meta.dir, '../../../../../apps/web/public/ava_colect');

// URL served by the Vite static server (or Nginx in production)
const AVATARS_BASE_URL = '/ava_colect';

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|webp|gif|svg|avif)$/i;

/**
 * Reads the avatar directory and returns a list of public URLs.
 * When an admin adds new image files to the directory, this endpoint reflects them automatically.
 */
export async function getAvatarCollection(): Promise<{ avatars: string[] }> {
  try {
    const files = await readdir(AVATARS_DIR);
    const avatars = files
      .filter((f) => IMAGE_EXTENSIONS.test(f))
      .sort() // ensure stable ordering
      .map((f) => `${AVATARS_BASE_URL}/${f}`);

    return { avatars };
  } catch {
    // Directory does not exist or is unreadable — return empty array
    return { avatars: [] };
  }
}

export interface UpdateProfileData {
  displayName?: string;
  avatarUrl?: string;
}

export async function updateProfile(userId: string, data: UpdateProfileData) {
  const updates: Partial<typeof users.$inferInsert> = {};

  if (data.displayName !== undefined) {
    const trimmed = data.displayName.trim();
    if (trimmed.length === 0) {
      throw new ValidationError('Display name cannot be empty');
    }
    updates.displayName = trimmed;
  }

  if (data.avatarUrl !== undefined) {
    // Allow empty string to clear the avatar (revert to default)
    updates.avatarUrl = data.avatarUrl || null;
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    });

  return { user: updated };
}
