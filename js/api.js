/**
 * Backend API helpers for OntoBench.
 *
 * In development (Vite on :1420): points to FastAPI on localhost:8000.
 * In production (FastAPI serves everything): relative URLs.
 */

// Vite dev server proxies API calls to FastAPI, so relative URLs work everywhere.
export const BACKEND = '';

/**
 * POST JSON to a backend endpoint and return parsed JSON.
 */
export async function apiPost(endpoint, body) {
  const res = await fetch(BACKEND + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
  return data;
}

/**
 * GET a backend endpoint and return parsed JSON.
 */
export async function apiGet(endpoint) {
  const res = await fetch(BACKEND + endpoint);
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
  return data;
}

/**
 * POST a file (multipart) to a backend endpoint and return parsed JSON.
 */
export async function apiUpload(endpoint, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(BACKEND + endpoint, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
  return data;
}
