// API client and shared app state.
import { store as ls } from './ui.js';

// A support session (admin impersonation) lives only in this tab, so the admin's own sign-in is untouched.
const impersonation = (() => { try { return sessionStorage.getItem('pliopad.imp'); } catch { return null; } })();

export const state = {
  impersonating: !!impersonation,
  token: impersonation || ls.get('token'),
  me: null, // { user, workspaces, ai, billing, plans, app }
  wsId: null,
  boot: null, // { workspace, notebooks, tags, tree, members, seq }
};

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Changes will be saved when the connection returns.', 'offline');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'auth') onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.code);
  return data;
}

export const wsApi = (method, path, body) => api(method, `/w/${state.wsId}${path}`, body);

export async function upload(file, noteId) {
  const fd = new FormData();
  fd.append('file', file);
  if (noteId) fd.append('note_id', noteId);
  const res = await fetch(`/api/w/${state.wsId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Upload failed');
  return data;
}

/** Downloads an authenticated endpoint as a file. */
export async function download(path, filename) {
  const res = await fetch('/api' + path, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function setToken(t) {
  state.token = t;
  if (state.impersonating) {
    try { if (t) sessionStorage.setItem('pliopad.imp', t); else sessionStorage.removeItem('pliopad.imp'); } catch { /* ignore */ }
    if (!t) state.impersonating = false;
    return;
  }
  if (t) ls.set('token', t); else ls.del('token');
}

export function startImpersonation(t) {
  try { sessionStorage.setItem('pliopad.imp', t); } catch { /* ignore */ }
  state.impersonating = true;
  state.token = t;
}

export const ws = () => state.boot?.workspace;
export const role = () => ws()?.role || 'guest';
export const canWrite = () => role() !== 'guest';
export const isAdmin = () => ['admin', 'owner'].includes(role());
export const noteMeta = (id) => state.boot?.tree.find((n) => n.id === id);
export const notebook = (id) => state.boot?.notebooks.find((n) => n.id === id);
export const tag = (id) => state.boot?.tags.find((t) => t.id === id);
export const member = (id) => state.boot?.members.find((m) => Number(m.id) === Number(id));
