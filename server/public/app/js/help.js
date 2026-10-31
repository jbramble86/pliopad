// Help center: articles (the same on every platform, served by the server), "Contact support", and the user's requests,
// which platform admins answer from the admin console.
import { h, icon, toast, relTime, fmtDate } from './ui.js';
import { state, api } from './api.js';
import { go } from './main.js';
import { attachPicker, messageFiles } from './support-ui.js';

const KINDS = [['question', 'A question'], ['problem', 'Something isn’t working'], ['billing', 'Billing or my plan'], ['idea', 'A feature idea']];
const STATUS = { open: ['Waiting for support', 'open'], answered: ['Support replied', 'answered'], on_hold: ['On hold', 'open'], closed: ['Solved', 'closed'] };
let articles = null;

const base = () => `#/w/${state.wsId}/help`;
const topbar = (...crumbs) => h('div', { class: 'topbar' },
  h('button', { class: 'btn icon mobile-only', onclick: () => { document.querySelector('.shell').dataset.pane = 'side'; } }, icon('menu')),
  h('span', { class: 'crumbs' }, ...crumbs.flatMap((c, i) => [i ? h('span', { class: 'muted' }, ' / ') : null,
    typeof c === 'string' ? h('span', { style: { padding: '2px 6px', color: 'var(--fg)' } }, c) : c])));
const crumb = (label, href) => h('a', { href, style: { padding: '2px 6px', color: 'var(--muted)' } }, label);

/** Article bodies: paragraphs separated by blank lines; "- " and "1. " lines become lists. */
function articleBody(text) {
  return text.split(/\n\s*\n/).map((para) => {
    const lines = para.split('\n');
    if (lines.every((l) => /^- /.test(l))) return h('ul', {}, lines.map((l) => h('li', {}, l.slice(2))));
    if (lines.every((l) => /^\d+\. /.test(l))) return h('ol', {}, lines.map((l) => h('li', {}, l.replace(/^\d+\. /, ''))));
    return h('p', {}, lines.map((l, i) => [i ? h('br') : null, /^- /.test(l) ? '• ' + l.slice(2) : l]));
  });
}

/** The Help center: #/w/<ws>/help, …/help/a/<article>, …/help/new, …/help/t/<ticket>. */
export async function helpPage(main, kind, id) {
  const scroll = h('div', { class: 'main-scroll' });
  const page = h('div', { class: 'page help' });
  scroll.append(page);
  if (!articles) {
    main.replaceChildren(topbar('Help center'), scroll);
    page.append(h('div', { class: 'empty' }, 'Loading…'));
    try { articles = await api('GET', '/help'); } catch (e) { page.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
    page.replaceChildren();
  }
  if (kind === 'a') return article(main, scroll, page, id);
  if (kind === 'new') return newRequest(main, scroll, page);
  if (kind === 't') return ticket(main, scroll, page, Number(id));
  return home(main, scroll, page);
}

async function home(main, scroll, page) {
  main.replaceChildren(topbar('Help center'), scroll);
  const results = h('div', { class: 'help-results' });
  const search = h('input', { class: 'input help-search', placeholder: 'Search help articles…', autofocus: true,
    oninput: () => {
      const q = search.value.trim().toLowerCase();
      results.replaceChildren(...(!q ? [] : articles.articles.filter((a) => (a.title + ' ' + a.body).toLowerCase().includes(q)).map(articleLink)));
      if (q && !results.children.length) results.append(h('div', { class: 'muted', style: { padding: '8px 2px' } }, 'No articles match. Ask us instead.'));
      cats.hidden = !!q;
    } });
  const articleLink = (a) => h('a', { class: 'help-link', href: `${base()}/a/${a.id}` }, icon('page'), h('span', {}, a.title));
  const cats = h('div', { class: 'help-cats' }, articles.categories.map((c) => h('div', { class: 'help-cat' },
    h('div', { class: 'help-cat-head' }, h('span', { class: 'help-cat-ico' }, c.icon), c.name),
    articles.articles.filter((a) => a.category === c.id).map(articleLink))));
  const requests = h('div', {}, h('div', { class: 'muted' }, 'Loading your requests…'));
  page.append(
    h('div', { class: 'help-hero' }, h('h1', {}, 'How can we help?'), search, results),
    cats,
    h('div', { class: 'help-contact card' },
      h('div', { class: 'grow' }, h('h3', {}, 'Still need help?'), h('div', { class: 'muted' }, 'Send us a message. We reply by email and here in the Help center, on every device.')),
      h('a', { class: 'btn primary', href: `${base()}/new` }, icon('chat'), 'Contact support')),
    h('h3', { class: 'help-h' }, 'Your requests'), requests);
  try {
    const mine = await api('GET', '/support/tickets');
    requests.replaceChildren(...(mine.length ? mine.map((t) => h('a', { class: 'help-ticket' + (t.unread ? ' unread' : ''), href: `${base()}/t/${t.id}` },
      h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ellipsis', style: { fontWeight: 600 } }, t.subject),
        h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `#${t.id} · updated ${relTime(t.updated_at)}`)),
      t.unread ? h('span', { class: 'help-new' }, 'New reply') : null,
      h('span', { class: 'help-status ' + STATUS[t.status][1] }, STATUS[t.status][0])))
      : [h('div', { class: 'muted' }, 'You haven’t contacted support yet.')]));
  } catch (e) { requests.replaceChildren(h('div', { class: 'muted' }, e.message)); }
}

function article(main, scroll, page, id) {
  const a = articles.articles.find((x) => x.id === id);
  if (!a) return go(base());
  const cat = articles.categories.find((c) => c.id === a.category);
  main.replaceChildren(topbar(crumb('Help center', base()), a.title), scroll);
  const related = articles.articles.filter((x) => x.category === a.category && x.id !== a.id);
  page.append(
    h('div', { class: 'muted', style: { marginBottom: '6px' } }, `${cat?.icon || ''} ${cat?.name || ''}`),
    h('h1', { class: 'help-title' }, a.title),
    h('div', { class: 'help-article' }, ...articleBody(a.body)),
    related.length ? h('div', { class: 'help-related' }, h('h3', { class: 'help-h' }, 'Related'), related.map((r) => h('a', { class: 'help-link', href: `${base()}/a/${r.id}` }, icon('page'), r.title))) : null,
    h('div', { class: 'help-contact card' }, h('div', { class: 'grow' }, h('h3', {}, 'Didn’t answer your question?'), h('div', { class: 'muted' }, 'Tell us what you need and we’ll get back to you.')),
      h('a', { class: 'btn primary', href: `${base()}/new` }, icon('chat'), 'Contact support')));
}

function newRequest(main, scroll, page) {
  main.replaceChildren(topbar(crumb('Help center', base()), 'Contact support'), scroll);
  const kind = h('select', { class: 'input' }, KINDS.map(([v, l]) => h('option', { value: v }, l)));
  const subject = h('input', { class: 'input', maxLength: 200, placeholder: 'A short summary' });
  const body = h('textarea', { class: 'input', rows: 8, placeholder: 'What happened, what you expected, and any steps to reproduce it. The more detail, the faster we can help.' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Send to support');
  const files = attachPicker();
  page.append(h('h1', { class: 'help-title' }, 'Contact support'),
    h('p', { class: 'muted' }, 'We reply by email and in the Help center. Your app and version are included automatically.'),
    h('form', { class: 'help-form', onsubmit: async (e) => {
      e.preventDefault();
      if (!subject.value.trim() || !body.value.trim()) return toast('Add a subject and a description.', { error: true });
      if (files.busy()) return toast('Wait for the attachments to finish uploading.', { error: true });
      btn.disabled = true;
      try {
        const t = await api('POST', '/support/tickets', { subject: subject.value.trim(), body: body.value.trim(), category: kind.value,
          platform: 'Web', app_version: state.me?.app?.version || null, workspace_id: state.wsId, files: files.ids() });
        toast('Sent. We’ll get back to you soon.');
        go(`${base()}/t/${t.id}`);
      } catch (x) { toast(x.message, { error: true }); btn.disabled = false; }
    } },
    h('label', { class: 'field' }, h('span', {}, 'What’s it about?'), kind),
    h('label', { class: 'field' }, h('span', {}, 'Subject'), subject),
    h('label', { class: 'field' }, h('span', {}, 'Details'), body),
    h('div', { class: 'field' }, h('span', {}, 'Screenshots or files (optional)'), files.chips, files.input),
    h('div', { class: 'row', style: { gap: '8px' } }, btn, files.button, h('a', { class: 'btn', href: base() }, 'Cancel'))));
  setTimeout(() => subject.focus(), 30);
}

async function ticket(main, scroll, page, id) {
  main.replaceChildren(topbar(crumb('Help center', base()), 'Request #' + id), scroll);
  let t;
  try { t = await api('GET', `/support/tickets/${id}`); } catch (e) { page.append(h('div', { class: 'empty' }, e.message)); return; }
  state.supportUnread = Math.max(0, (state.supportUnread || 0) - 1);
  const reply = h('textarea', { class: 'input', rows: 4, placeholder: t.status === 'closed' ? 'Write to reopen this request…' : 'Write a reply…' });
  const files = attachPicker();
  const send = async () => {
    if (!reply.value.trim()) return;
    if (files.busy()) return toast('Wait for the attachments to finish uploading.', { error: true });
    try { await api('POST', `/support/tickets/${id}/messages`, { body: reply.value.trim(), files: files.ids() }); helpPage(main, 't', id); } catch (e) { toast(e.message, { error: true }); }
  };
  const rate = async (rating) => {
    const comment = rating === 'bad' ? window.prompt('Sorry about that. What could we have done better? (optional)') : null;
    try { await api('POST', `/support/tickets/${id}/rate`, { rating, comment }); toast('Thanks for the feedback'); helpPage(main, 't', id); } catch (e) { toast(e.message, { error: true }); }
  };
  page.append(
    h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '12px' } }, h('div', { class: 'grow' }, h('h1', { class: 'help-title' }, t.subject),
      h('div', { class: 'muted' }, `#${t.id} · opened ${fmtDate(t.created_at)}`)), h('span', { class: 'help-status ' + STATUS[t.status][1] }, STATUS[t.status][0])),
    h('div', { class: 'help-thread' }, t.messages.map((m) => h('div', { class: 'help-msg' + (m.staff ? ' staff' : '') },
      h('div', { class: 'help-meta' }, h('b', {}, m.staff ? `${m.author || 'Support'} · PlioPad support` : 'You'), ' · ', fmtDate(m.created_at)),
      h('div', { class: 'help-body' }, m.body), messageFiles(m.files)))),
    t.status === 'closed' && !t.rating ? h('div', { class: 'help-rate card' }, h('b', { class: 'grow' }, 'How did we do?'),
      h('button', { class: 'btn', onclick: () => rate('good') }, '👍 Good'), h('button', { class: 'btn', onclick: () => rate('bad') }, '👎 Not great')) : null,
    t.rating ? h('div', { class: 'muted', style: { marginTop: '10px' } }, `You rated this ${t.rating === 'good' ? '👍 good' : '👎 not great'}. Thanks!`) : null,
    h('div', { class: 'help-reply' }, reply, files.chips, files.input, h('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } },
      h('button', { class: 'btn primary', onclick: send }, t.status === 'closed' ? 'Reopen and send' : 'Send reply'), files.button,
      t.status !== 'closed' ? h('button', { class: 'btn', onclick: async () => { await api('POST', `/support/tickets/${id}/close`); toast('Marked as solved'); helpPage(main, 't', id); } }, 'Mark as solved') : null)));
}

/** How many requests have a reply the user hasn't read (for the sidebar). */
export async function refreshSupportUnread() {
  try { state.supportUnread = (await api('GET', '/support/tickets')).filter((t) => t.unread).length; } catch { /* offline */ }
  return state.supportUnread || 0;
}
