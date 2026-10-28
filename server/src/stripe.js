// Stripe billing over plain HTTPS (no SDK needed): Checkout, Customer Portal, seat sync and signed webhooks.
import crypto from 'node:crypto';
import { db } from './db.js';
import { ApiError, setting, nowMs, jenc } from './util.js';

export const stripeEnabled = () => !!setting('stripe_secret');

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') form(v, key, out);
    else if (v !== undefined && v !== null) out.append(key, String(v));
  }
  return out;
}

export async function stripe(method, path, params = {}) {
  const qs = method === 'GET' && Object.keys(params).length ? '?' + form(params) : '';
  const res = await fetch(`https://api.stripe.com/v1/${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${setting('stripe_secret')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : form(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(502, 'Billing error: ' + (data.error?.message || res.status));
  return data;
}

const seatCount = async (ws) => Math.max(1, Number(await db.val("SELECT COUNT(*) FROM members WHERE workspace_id=? AND role<>'guest'", [ws.id])));

export async function checkout(ws, user, plan, base) {
  const price = (setting('stripe_prices', {}) || {})[plan];
  if (!price) throw new ApiError(422, 'This plan is not available for online checkout. Contact sales.');
  const params = {
    mode: 'subscription', line_items: { 0: { price, quantity: await seatCount(ws) } },
    success_url: `${base}/app/#/billing?ok=1`, cancel_url: `${base}/app/#/billing`,
    client_reference_id: ws.id, metadata: { workspace_id: ws.id, plan },
    subscription_data: { metadata: { workspace_id: ws.id, plan } }, allow_promotion_codes: 'true',
  };
  if (ws.stripe_customer) params.customer = ws.stripe_customer;
  else params.customer_email = user.email;
  return (await stripe('POST', 'checkout/sessions', params)).url;
}

export async function portal(ws, base) {
  if (!ws.stripe_customer) throw new ApiError(422, 'No billing account yet.');
  return (await stripe('POST', 'billing_portal/sessions', { customer: ws.stripe_customer, return_url: `${base}/app/#/billing` })).url;
}

/** Keeps the subscription's seat count in step with membership (called after members change). */
export async function syncSeats(ws) {
  if (!stripeEnabled() || !ws.stripe_sub) return;
  try {
    const sub = await stripe('GET', `subscriptions/${ws.stripe_sub}`);
    const item = sub.items?.data?.[0]?.id;
    if (item) await stripe('POST', `subscription_items/${item}`, { quantity: await seatCount(ws), proration_behavior: 'create_prorations' });
  } catch (e) {
    console.error('[pliopad] seat sync failed:', e.message);
  }
}

export async function webhook(raw, sigHeader) {
  const secret = String(setting('stripe_webhook_secret') || '');
  const parts = {};
  for (const p of String(sigHeader).split(',')) {
    const [k, v] = p.split('=');
    (parts[k] ||= []).push(v);
  }
  const t = Number(parts.t?.[0] || 0);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const ok = (parts.v1 || []).some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!secret || !ok || Math.abs(Date.now() / 1000 - t) > 600) throw new ApiError(400, 'Bad signature');

  const event = JSON.parse(raw);
  const obj = event.data?.object || {};
  const wsId = Number(obj.metadata?.workspace_id || obj.client_reference_id || 0);
  if (!wsId) return;
  switch (event.type) {
    case 'checkout.session.completed':
      await db.update('workspaces', { stripe_customer: obj.customer, stripe_sub: obj.subscription, plan: obj.metadata?.plan || 'pro' }, { id: wsId });
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const live = ['active', 'trialing', 'past_due'].includes(obj.status);
      await db.update('workspaces', { plan: live ? obj.metadata?.plan || 'pro' : 'free', plan_renews: obj.current_period_end ? obj.current_period_end * 1000 : null,
        seats: obj.items?.data?.[0]?.quantity || 1 }, { id: wsId });
      break;
    }
    case 'customer.subscription.deleted':
      await db.update('workspaces', { plan: 'free', stripe_sub: null, plan_renews: null }, { id: wsId });
      break;
  }
  await db.insert('audit', { workspace_id: wsId, action: 'billing.' + event.type, meta: jenc({ id: event.id }), created_at: nowMs() });
}
