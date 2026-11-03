import { rm } from 'node:fs/promises';

import type { Logger } from '../lib/logger.js';
import type { SourceFileStore } from '../ports/source-file-store.js';

/** `SourceFileStore` on the local disk (`UPLOAD_DIR`). */
export function createLocalSourceFileStore(logger: Logger): SourceFileStore {
  return {
    async remove(path: string): Promise<void> {
      // The row is already gone when this runs; a leftover file is not worth failing over.
      await rm(path, { force: true }).catch((error: unknown) => {
        logger.warn(`could not remove the stored upload ${path}`, error);
      });
    },
  };
}
