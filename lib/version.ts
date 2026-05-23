// ─── App Version Config ───────────────────────────────────────────────────────
// Update APP_VERSION here whenever you deploy a new release.
// This is the only file you need to touch to change the version number.

export const APP_VERSION = "0.1.0";

// Build timestamp — set at startup so it reflects when the server last booted.
// On Vercel this effectively equals your deployment time.
export const DEPLOY_TIMESTAMP = new Date().toISOString();
