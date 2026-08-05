interface Env {
  /** Encrypted Cloudflare Worker secret. */
  GITHUB_CLIENT_ID: string;
  /** Encrypted Cloudflare Worker secret. */
  GITHUB_CLIENT_SECRET: string;
  /** Encrypted Cloudflare Worker secret used only for HMAC signing. */
  SESSION_SECRET: string;
}
