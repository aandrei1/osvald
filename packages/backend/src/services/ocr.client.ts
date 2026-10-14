import { z } from 'zod';

import { env } from '../config/env.js';
import { BadRequestError } from '../lib/errors.js';

/**
 * Client for the Python OCR service (`packages/ocr-service`).
 *
 * The wire format is defined by that service — see
 * `packages/ocr-service/app/schemas.py`. It is validated here because it is an
 * external boundary: the Python side cannot import our Zod schemas, so drift
 * has to be caught at runtime.
 */

export const ocrBoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const ocrTextBlockSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  bbox: ocrBoundingBoxSchema,
  /** Index of the page the block was found on. */
  page: z.number().int().nonnegative(),
});

export const ocrResponseSchema = z.object({
  blocks: z.array(ocrTextBlockSchema),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  language: z.string(),
});

/** How one page's text was obtained. Mirrors `PdfPageText.source`. */
export const pdfPageSourceSchema = z.enum(['text-layer', 'ocr', 'skipped', 'error']);

export const pdfPageTextSchema = z.object({
  page: z.number().int().positive(),
  text: z.string(),
  source: pdfPageSourceSchema,
});

export const pdfTextResponseSchema = z.object({
  pages: z.array(pdfPageTextSchema),
  page_count: z.number().int().nonnegative(),
  ocr_page_count: z.number().int().nonnegative(),
  engine: z.string(),
  language: z.string(),
});

export type OcrTextBlock = z.infer<typeof ocrTextBlockSchema>;
export type OcrResponse = z.infer<typeof ocrResponseSchema>;
export type PdfPageText = z.infer<typeof pdfPageTextSchema>;
export type PdfTextResponse = z.infer<typeof pdfTextResponseSchema>;

/** Raised when the OCR service answers with an error status. */
export class OcrServiceError extends Error {
  readonly statusCode: number;
  /** A 4xx/501 will fail the same way on every retry; a 5xx may not. */
  readonly retryable: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'OcrServiceError';
    this.statusCode = statusCode;
    this.retryable = statusCode >= 500 && statusCode !== 501;
  }
}

export interface ExtractPdfTextOptions {
  /** `all`, `12` (first 12) or `5-20` (inclusive). */
  pages?: string;
  language?: string;
  /** Ignore any embedded text layer and recognise every page. */
  forceOcr?: boolean;
}

export interface OcrClient {
  /** `POST /ocr/pdf` — a PDF in, the text of every page out. */
  extractPdfText(
    pdf: Uint8Array,
    fileName: string,
    options?: ExtractPdfTextOptions,
  ): Promise<PdfTextResponse>;
  /** `POST /ocr` — one page image in, positioned text blocks out. */
  recognizeImage(image: Uint8Array, options?: { language?: string }): Promise<OcrResponse>;
  /** `GET /health` — used by the backend health probe. */
  isHealthy(): Promise<boolean>;
}

/** The service reports its own failures as `{ "detail": "..." }`. */
const errorBodySchema = z.object({ detail: z.unknown() });

async function describeFailure(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = errorBodySchema.safeParse(payload);

  if (parsed.success && typeof parsed.data.detail === 'string') {
    return parsed.data.detail;
  }

  return `OCR service responded with HTTP ${response.status}`;
}

export function createOcrClient(): OcrClient {
  const post = async (path: string, body: FormData, timeoutMs: number): Promise<unknown> => {
    let response: Response;

    try {
      response = await fetch(`${env.OCR_SERVICE_URL}${path}`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Unreachable or timed out: worth another attempt later.
      throw new OcrServiceError(
        `OCR service at ${env.OCR_SERVICE_URL} is unreachable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
        503,
      );
    }

    if (!response.ok) {
      throw new OcrServiceError(await describeFailure(response), response.status);
    }

    return response.json();
  };

  return {
    async extractPdfText(pdf, fileName, options = {}): Promise<PdfTextResponse> {
      if (pdf.byteLength === 0) {
        throw new BadRequestError('The stored PDF is empty');
      }

      const form = new FormData();
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), fileName);
      form.append('pages', options.pages ?? 'all');
      form.append('force_ocr', String(options.forceOcr ?? false));

      if (options.language !== undefined) {
        form.append('language', options.language);
      }

      // OCR of a long document is minutes of work, so this timeout is far more
      // generous than the one used for interactive requests.
      return pdfTextResponseSchema.parse(await post('/ocr/pdf', form, env.OCR_PDF_TIMEOUT_MS));
    },

    async recognizeImage(image, options = {}): Promise<OcrResponse> {
      const form = new FormData();
      form.append('image', new Blob([image], { type: 'image/png' }), 'page.png');

      const query =
        options.language !== undefined ? `?language=${encodeURIComponent(options.language)}` : '';

      return ocrResponseSchema.parse(await post(`/ocr${query}`, form, env.OCR_REQUEST_TIMEOUT_MS));
    },

    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch(`${env.OCR_SERVICE_URL}/health`, {
          signal: AbortSignal.timeout(1_500),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
