/**
 * Who is using the app.
 *
 * Identity lives in a server-side session keyed by an httpOnly cookie, not in
 * browser storage: the page cannot read or forge it, and the server decides
 * whose history to return. The name itself is durable because it is written on
 * every row the user creates, so losing a session costs a re-prompt, not data.
 */
let current = '';

export function getUser() {
  return current;
}

/** Ask the server who we are, if anyone. */
export async function loadUser() {
  try {
    const res = await fetch('/api/session', { credentials: 'same-origin' });
    if (!res.ok) return '';
    current = (await res.json()).userName || '';
  } catch {
    current = '';
  }
  return current;
}

export async function setUser(name) {
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean) return '';
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name: clean }),
  });
  if (!res.ok) throw new Error(`could not start session (${res.status})`);
  current = (await res.json()).userName || clean;
  return current;
}

/** Resolves once a name is known, prompting only when the server has none. */
export async function ensureUser({ onPrompt }) {
  const existing = await loadUser();
  if (existing) return existing;
  return new Promise((resolve) => {
    onPrompt(async (name) => {
      try {
        resolve(await setUser(name));
      } catch {
        resolve('');
      }
    });
  });
}
