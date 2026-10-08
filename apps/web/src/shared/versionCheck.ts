const RELOAD_FLAG = 'papp.versionReloadedFor';

/**
 * D94: compares the bundle's baked-in `__APP_VERSION__` with the server's
 * `/version.json` and does a real page reload only on a mismatch, so a user
 * with a stale tab picks up a new deployment when they next reach the login
 * page. Best-effort: any failure (offline, dev server, bad JSON) is ignored.
 * A sessionStorage flag keyed by the server version prevents a reload loop if
 * the reload somehow still serves the old bundle.
 */
export async function reloadIfNewVersion(): Promise<boolean> {
  if (import.meta.env.DEV) return false;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const { version } = (await res.json()) as { version?: unknown };
    if (typeof version !== 'string' || version === __APP_VERSION__) return false;
    if (sessionStorage.getItem(RELOAD_FLAG) === version) return false;
    sessionStorage.setItem(RELOAD_FLAG, version);
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
