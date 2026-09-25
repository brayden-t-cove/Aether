/**
 * Uploaded files on local disk (a Railway volume in production).
 *
 * Files are stored under random names (never the uploader's filename), in
 * one folder per month. Only the attachments table knows the original name.
 * Downloads go through an authenticated route; see routes/attachments.js.
 */
import { mkdir, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';

export function createFileStore({ filesDir, maxUploadMb = 25 }) {
  if (!filesDir) return null;
  const root = resolve(filesDir);

  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const month = new Date().toISOString().slice(0, 7);
      try {
        await mkdir(join(root, month), { recursive: true });
        cb(null, join(root, month));
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => cb(null, randomUUID()),
  });

  const upload = multer({ storage, limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 } });

  /** Absolute path for a storage key, refusing anything that escapes the root. */
  const pathFor = (key) => {
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error('Invalid storage key');
    return full;
  };

  return {
    root,
    maxUploadMb,
    single: (field) => upload.single(field),
    keyFor: (absolutePath) => absolutePath.slice(root.length + 1),
    pathFor,
    remove: async (key) => {
      try {
        await unlink(pathFor(key));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    },
  };
}
