// Help center articles: stored in the database and edited from the admin console (Help articles).
// Every app loads them from GET /api/help, so a change shows everywhere at once.
import { route } from '../http.js';
import { db } from '../db.js';
import * as A from '../auth.js';
import { ApiError, nowMs, clampStr } from '../util.js';

const category = (c) => ({ id: c.id, name: c.name, icon: c.icon || '', sort: Number(c.sort) });
const article = (a) => ({ id: a.id, category: a.category_id, title: a.title, body: a.body, sort: Number(a.sort), published: !!Number(a.published), updated_at: Number(a.updated_at) });

/** A short, readable id for links (…/help/a/<id>), unique among existing ones. */
async function slug(table, text) {
  const base = String(text).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'article';
  let id = base;
  for (let i = 2; await db.val(`SELECT 1 FROM ${table} WHERE id=?`, [id]); i++) id = `${base}-${i}`;
  return id;
}

async function all({ drafts }) {
  const categories = (await db.all('SELECT * FROM help_categories ORDER BY sort, name')).map(category);
  const articles = (await db.all(`SELECT * FROM help_articles ${drafts ? '' : 'WHERE published=1'} ORDER BY sort, title`)).map(article);
  return { categories, articles };
}

// ---------- Public ----------

route('GET', '/api/help', async () => {
  const { categories, articles } = await all({ drafts: false });
  // Categories with nothing published yet stay out of sight.
  return { categories: categories.filter((c) => articles.some((a) => a.category === c.id)), articles: articles.map(({ published, ...a }) => a) };
});

/** "Did this help?" One answer per person per article; answering again changes it. */
route('POST', '/api/help/:id/feedback', async (ctx) => {
  const u = await A.requireUser(ctx);
  if (!(await db.val('SELECT 1 FROM help_articles WHERE id=?', [ctx.params.id]))) throw new ApiError(404, 'Article not found.');
  await db.q('DELETE FROM help_feedback WHERE article_id=? AND user_id=?', [ctx.params.id, u.id]);
  await db.insert('help_feedback', { article_id: ctx.params.id, user_id: u.id, helpful: ctx.body.helpful ? 1 : 0, created_at: nowMs() });
  return { ok: true };
});

// ---------- Admin ----------

route('GET', '/api/admin/help', async (ctx) => {
  await A.requireSuper(ctx);
  const data = await all({ drafts: true });
  // How each article is doing: "Did this help?" answers, and requests asked from it.
  const votes = await db.all('SELECT article_id, SUM(helpful) AS yes, COUNT(*) AS total FROM help_feedback GROUP BY article_id');
  const asked = await db.all('SELECT article_id, COUNT(*) AS n FROM tickets WHERE article_id IS NOT NULL GROUP BY article_id');
  for (const a of data.articles) {
    const v = votes.find((x) => x.article_id === a.id);
    a.helpful = Number(v?.yes || 0);
    a.not_helpful = Number(v?.total || 0) - a.helpful;
    a.requests = Number(asked.find((x) => x.article_id === a.id)?.n || 0);
  }
  return data;
});

route('POST', '/api/admin/help/articles', async (ctx) => {
  const u = await A.requireSuper(ctx);
  const title = String(ctx.in('title', '')).trim();
  const cat = String(ctx.in('category', ''));
  if (!title) throw new ApiError(422, 'Give the article a title.');
  if (!(await db.val('SELECT 1 FROM help_categories WHERE id=?', [cat]))) throw new ApiError(422, 'Choose a category.');
  const id = await slug('help_articles', title);
  const sort = Number(await db.val('SELECT COALESCE(MAX(sort), -1) + 1 FROM help_articles WHERE category_id=?', [cat]));
  await db.insert('help_articles', { id, category_id: cat, title: clampStr(title, 200), body: clampStr(String(ctx.in('body', '')), 100000), sort,
    published: ctx.body.published === false ? 0 : 1, updated_at: nowMs(), updated_by: u.id });
  await A.audit(ctx, null, 'help.article_created', id);
  return article(await db.one('SELECT * FROM help_articles WHERE id=?', [id]));
});

route('PATCH', '/api/admin/help/articles/:id', async (ctx) => {
  const u = await A.requireSuper(ctx);
  const a = await db.one('SELECT * FROM help_articles WHERE id=?', [ctx.params.id]);
  if (!a) throw new ApiError(404, 'Article not found.');
  const d = { updated_at: nowMs(), updated_by: u.id };
  if (ctx.has('title')) { const t = String(ctx.body.title).trim(); if (!t) throw new ApiError(422, 'Give the article a title.'); d.title = clampStr(t, 200); }
  if (ctx.has('body')) d.body = clampStr(String(ctx.body.body), 100000);
  if (ctx.has('published')) d.published = ctx.body.published ? 1 : 0;
  if (ctx.has('category') && ctx.body.category !== a.category_id) {
    if (!(await db.val('SELECT 1 FROM help_categories WHERE id=?', [ctx.body.category]))) throw new ApiError(422, 'Choose a category.');
    d.category_id = ctx.body.category;
    d.sort = Number(await db.val('SELECT COALESCE(MAX(sort), -1) + 1 FROM help_articles WHERE category_id=?', [ctx.body.category]));
  }
  await db.update('help_articles', d, { id: a.id });
  await A.audit(ctx, null, 'help.article_updated', a.id);
  return article(await db.one('SELECT * FROM help_articles WHERE id=?', [a.id]));
});

route('DELETE', '/api/admin/help/articles/:id', async (ctx) => {
  await A.requireSuper(ctx);
  await db.q('DELETE FROM help_articles WHERE id=?', [ctx.params.id]);
  await db.q('DELETE FROM help_feedback WHERE article_id=?', [ctx.params.id]);
  await A.audit(ctx, null, 'help.article_deleted', ctx.params.id);
  return { ok: true };
});

route('POST', '/api/admin/help/categories', async (ctx) => {
  await A.requireSuper(ctx);
  const name = String(ctx.in('name', '')).trim();
  if (!name) throw new ApiError(422, 'Give the category a name.');
  const id = await slug('help_categories', name);
  const sort = Number(await db.val('SELECT COALESCE(MAX(sort), -1) + 1 FROM help_categories'));
  await db.insert('help_categories', { id, name: clampStr(name, 120), icon: clampStr(String(ctx.in('icon', '') || '📄'), 16), sort });
  await A.audit(ctx, null, 'help.category_created', id);
  return category(await db.one('SELECT * FROM help_categories WHERE id=?', [id]));
});

route('PATCH', '/api/admin/help/categories/:id', async (ctx) => {
  await A.requireSuper(ctx);
  const d = {};
  if (ctx.has('name')) { const n = String(ctx.body.name).trim(); if (!n) throw new ApiError(422, 'Give the category a name.'); d.name = clampStr(n, 120); }
  if (ctx.has('icon')) d.icon = clampStr(String(ctx.body.icon || ''), 16);
  if (Object.keys(d).length) await db.update('help_categories', d, { id: ctx.params.id });
  return { ok: true };
});

route('DELETE', '/api/admin/help/categories/:id', async (ctx) => {
  await A.requireSuper(ctx);
  if (Number(await db.val('SELECT COUNT(*) FROM help_articles WHERE category_id=?', [ctx.params.id]))) {
    throw new ApiError(409, 'Move or delete this category’s articles first.');
  }
  await db.q('DELETE FROM help_categories WHERE id=?', [ctx.params.id]);
  await A.audit(ctx, null, 'help.category_deleted', ctx.params.id);
  return { ok: true };
});

/** Saves the order: categories as listed, and each category's articles as listed. */
route('POST', '/api/admin/help/order', async (ctx) => {
  await A.requireSuper(ctx);
  for (const [i, id] of (Array.isArray(ctx.body.categories) ? ctx.body.categories : []).entries()) await db.update('help_categories', { sort: i }, { id: String(id) });
  for (const [i, id] of (Array.isArray(ctx.body.articles) ? ctx.body.articles : []).entries()) await db.update('help_articles', { sort: i }, { id: String(id) });
  return { ok: true };
});
