/**
 * Where uploaded PDFs are kept (local disk for now).
 *
 * TODO: [Stocare] Move uploads to object storage (S3/R2) behind this port and keep a key on the row.
 */
export interface SourceFileStore {
  /** Removes a stored upload. A file that is already gone is not an error. */
  remove(path: string): Promise<void>;
}
