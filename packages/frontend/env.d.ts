/// <reference types="vite/client" />

/**
 * Typed `import.meta.env` for the frontend.
 * Only `VITE_`-prefixed variables are exposed to client code (see .env.example).
 */
interface ImportMetaEnv {
  /** Base URL of the backend API, e.g. `http://localhost:3000`. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
