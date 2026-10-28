// AI features powered by Claude through the official Anthropic SDK.
// The API key is set in the admin console (Settings → AI) or with the ANTHROPIC_API_KEY environment variable.
import Anthropic from '@anthropic-ai/sdk';
import { ApiError, setting } from './util.js';
import { search, findNote } from './notes.js';

export const MODEL = 'claude-opus-5-5';

const apiKey = () => String(setting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '');
export const aiAvailable = () => apiKey() !== '';

let client = null;
let clientKey = '';
function getClient() {
  if (!client || clientKey !== apiKey()) {
    clientKey = apiKey();
    client = new Anthropic({ apiKey: clientKey });
  }
  return client;
}

async function ask(system, prompt, { maxTokens = 4000, effort = 'low' } = {}) {
  if (!aiAvailable()) throw new ApiError(503, 'AI is not configured. A platform admin can add an Anthropic API key in Admin → Settings.');
  let response;
  try {
    // Server-side refusal fallback ("default" routes a declined request to a suitable model automatically).
    response = await getClient().beta.messages.create({
      model: setting('ai_model') || MODEL,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new ApiError(503, 'The AI service is busy. Try again in a moment.');
    if (error instanceof Anthropic.AuthenticationError) throw new ApiError(503, 'The AI API key is not valid. Check Admin → Settings.');
    if (error instanceof Anthropic.APIError) {
      console.error('[pliopad] Claude API error', error.status, error.message);
      throw new ApiError(error.status >= 500 ? 503 : 502, 'The AI request failed. Try again.');
    }
    throw error;
  }
  if (response.stop_reason === 'refusal') throw new ApiError(422, 'The AI declined this request.');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

const STYLE = 'You are the writing assistant inside Pliopad, a notes and docs app. Reply with the result only, '
  + 'as plain Markdown (headings, bullet lists and "- [ ]" checkboxes are fine). No preamble and no closing remarks.';

export async function runAction(action, title, text, opts = {}) {
  const doc = `Title: ${title}\n\n${text}`;
  const md = (prompt, o) => ask(STYLE, prompt, o).then((markdown) => ({ markdown }));
  switch (action) {
    case 'summarize': return md(`Summarize this note in 3-6 bullet points, then one line starting with "Bottom line:".\n\n${doc}`);
    case 'actions': return md(`Extract every action item in this note as "- [ ] task (owner if named) @YYYY-MM-DD if a date is given". If there are none, reply "- [ ] No action items found".\n\n${doc}`);
    case 'continue': return md(`Continue writing this note naturally for one or two paragraphs, matching its tone.\n\n${doc}`);
    case 'improve': return md(`Rewrite this text to be clearer and more concise. Keep the meaning and any Markdown structure.\n\n${opts.selection || text}`);
    case 'translate': return md(`Translate into ${opts.language || 'Spanish'}, keeping the Markdown structure.\n\n${opts.selection || text}`);
    case 'outline': return md(`Write a well-structured first draft for a page titled "${opts.topic || title}". Use headings and lists.`, { maxTokens: 8000, effort: 'medium' });
    case 'title': return { title: (await ask('Reply with a short title only (at most 8 words), without quotes.', doc, { maxTokens: 100 })).replace(/^["'\s]+|["'\s]+$/g, '') };
    case 'tags': {
      const pref = opts.existing?.length ? `Prefer these existing tags when they fit: ${opts.existing.join(', ')}.\n` : '';
      const raw = await ask('Reply with a comma-separated list of 1-5 short lowercase tags, nothing else.', pref + doc, { maxTokens: 200 });
      return { tags: raw.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean) };
    }
    default: throw new ApiError(422, 'Unknown AI action.');
  }
}

/** "Ask your notes": keyword retrieval over the workspace, then an answer that cites the notes it used. */
export async function askNotes(ws, question) {
  const words = [...new Set(question.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))].slice(0, 8);
  const hits = new Map();
  for (const w of words) for (const n of await search(ws, w, 15)) hits.set(n.id, (hits.get(n.id) || 0) + n.score + 1);
  const ids = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  const sources = [];
  let ctx = '';
  for (const id of ids) {
    const r = await findNote(ws, id);
    if (!r) continue;
    const num = sources.length + 1;
    sources.push({ id, title: r.title || 'Untitled', n: num });
    ctx += `<note n="${num}" title="${String(r.title).replace(/"/g, "'")}">\n${String(r.plain || '').slice(0, 6000)}\n</note>\n`;
  }
  if (!sources.length) return { answer: 'I could not find any notes about that.', sources: [] };
  const answer = await ask(
    'Answer the question using only the notes provided. Cite notes inline like [1] or [2]. If the notes do not contain the answer, say so plainly. Use concise Markdown.',
    `${ctx}\nQuestion: ${question}`, { maxTokens: 3000, effort: 'medium' });
  return { answer, sources };
}
