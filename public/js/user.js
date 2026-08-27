/**
 * Who is using the app.
 *
 * Asked once and remembered in localStorage, so the name survives reloads
 * without a login. It is sent with every saved item and used to scope the
 * history, so two people on the same deployment do not see each other's work.
 */
const KEY = 'procucev.userName';

export function getUser() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';   // private browsing, storage disabled
  }
}

export function setUser(name) {
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean) return '';
  try { localStorage.setItem(KEY, clean); } catch { /* not fatal */ }
  return clean;
}

export function clearUser() {
  try { localStorage.removeItem(KEY); } catch { /* not fatal */ }
}

/** Resolves once a name is known — showing the prompt only if needed. */
export function ensureUser({ onPrompt }) {
  const existing = getUser();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => onPrompt((name) => resolve(setUser(name))));
}
