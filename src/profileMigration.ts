import fs from 'node:fs';
import path from 'node:path';

/**
 * Copy the legacy Electron partition into cliweb's dedicated profile exactly once.
 * A staging directory keeps an interrupted copy from looking like a complete profile.
 */
export function migrateLegacyPartition(legacyPath: string, targetPath: string): boolean {
  if (!fs.existsSync(legacyPath) || fs.existsSync(targetPath)) return false;

  const parent = path.dirname(targetPath);
  const stagingPath = path.join(
    parent,
    `.${path.basename(targetPath)}.migrating-${process.pid}-${Date.now()}`,
  );
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });

  try {
    fs.cpSync(legacyPath, stagingPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    try {
      fs.renameSync(stagingPath, targetPath);
      return true;
    } catch (error) {
      // Another cliweb process may have completed the same migration first.
      if (fs.existsSync(targetPath)) return false;
      throw error;
    }
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}
