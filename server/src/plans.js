// Subscription plans and their limits. Prices and limits can be overridden from the admin console.
import { db } from './db.js';
import { ApiError, setting, jdec, month } from './util.js';

// audience: who the plan is sold to (personal or team). per: 'month' is a flat price, 'member' is per seat.
// The key 'pro' is kept for the Team plan so existing subscriptions and Stripe metadata keep working.
const DEFAULTS = {
  free: { name: 'Free', audience: 'both', per: 'month', price: 0, members: 3, storage_mb: 250, ai_per_month: 25, history_days: 7, audit: false, guests: false },
  personal: { name: 'Personal', audience: 'personal', per: 'month', price: 5, members: 1, storage_mb: 10240, ai_per_month: 500, history_days: 90, audit: false, guests: true },
  pro: { name: 'Team', audience: 'team', per: 'member', price: 8, members: 25, storage_mb: 10240, ai_per_month: 1000, history_days: 90, audit: false, guests: true },
  business: { name: 'Business', audience: 'team', per: 'member', price: 15, members: 500, storage_mb: 102400, ai_per_month: 5000, history_days: 365, audit: true, guests: true },
  enterprise: { name: 'Enterprise', audience: 'team', per: 'member', price: null, members: 100000, storage_mb: 1048576, ai_per_month: 50000, history_days: 3650, audit: true, guests: true },
};

export function allPlans() {
  const over = setting('plans', {}) || {};
  return Object.fromEntries(Object.entries(DEFAULTS).map(([k, p]) => [k, { ...p, ...(over[k] || {}) }]));
}

export const getPlan = (plan) => allPlans()[plan] || allPlans().free;

/** A limit for this workspace: a per-tenant override set by a platform admin wins over the plan. */
export function limit(ws, key) {
  const custom = jdec(ws.settings, {})?.limits?.[key];
  return custom ?? getPlan(ws.plan)[key];
}

export async function checkMembers(ws) {
  const n = Number(await db.val('SELECT COUNT(*) FROM members WHERE workspace_id=?', [ws.id]))
    + Number(await db.val('SELECT COUNT(*) FROM invites WHERE workspace_id=? AND accepted_at IS NULL', [ws.id]));
  if (n >= limit(ws, 'members')) throw new ApiError(402, "Your plan's member limit is reached. Upgrade to add more people.", 'limit');
}

export function checkStorage(ws, adding) {
  if (Number(ws.storage_bytes) + adding > limit(ws, 'storage_mb') * 1048576) {
    throw new ApiError(402, 'Your workspace is out of storage. Upgrade or remove some files.', 'limit');
  }
}

/** Counts one AI request against the monthly allowance. */
export async function useAi(ws) {
  const period = month();
  let used = Number(ws.ai_used);
  if (ws.ai_period !== period) {
    await db.update('workspaces', { ai_used: 0, ai_period: period }, { id: ws.id });
    used = 0;
  }
  if (used >= limit(ws, 'ai_per_month')) throw new ApiError(402, "You have used this month's AI allowance. Upgrade for more.", 'limit');
  await db.q('UPDATE workspaces SET ai_used = ai_used + 1 WHERE id=?', [ws.id]);
}
