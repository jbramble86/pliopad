# Where Pliopad can win

Notion is strong at structure and weak at fast capture, offline use and mobile. Evernote is strong at capture and weak at structure and collaboration. Pliopad's position: **capture like Evernote, organize like Notion, own your data, and work offline everywhere.**

## Already built

| Edge | Why it matters |
|---|---|
| **Block-level merge, no conflict copies** | Two people (or an offline phone) editing different parts of a page both keep their edits. Evernote creates "conflicting changes" duplicates, and Notion's offline mode is limited. |
| **Offline-first Android app** | Everything lives in Room on the phone and syncs in the background. Writing on a plane or in a basement just works. |
| **Scan + OCR + search** | Scan receipts, whiteboards and contracts on the phone. The text is recognized on the device and is searchable on every platform, including by AI. |
| **Ask your notes** | Answers to questions, drawn from your own notes, with numbered citations back to the source pages. |
| **Tasks inbox from every note** | Every `[ ]` in every note appears in one list, with due dates from `@2026-11-03`. You don't need a separate task app. |
| **Evernote and Notion import** | `.enex` (with tags, checklists and formatting) and Markdown/HTML. This is the switching path for unhappy Evernote users. |
| **Search operators** | `tag:` `notebook:` `is:todo` `has:image` `updated:7d` `-word` `"phrase"`, matching Evernote power users' muscle memory. |
| **Publish to the web** | Clean, SEO-friendly public pages for docs, roadmaps and wikis. |
| **Enterprise admin from day one** | Per-tenant limits, suspensions, audited support sessions, an audit log with CSV export, sign-up domain allow-lists, 2FA, session revocation and data export. These remove blockers for B2B sales. |
| **Self-hostable, cheap to run** | Runs on shared Node.js hosting with MySQL. That is a selling point for privacy-sensitive buyers (law, health, education, government) who won't use US-hosted SaaS. |

## Next: highest leverage

1. **Email-to-note.** Each user gets an address like `save+abc123@your-domain`, and forwarded emails become notes with attachments. Evernote users miss this most. It needs an inbound mail webhook (Mailgun or Postmark).
2. **Real-time co-editing.** Upgrade from presence plus live refresh to character-level collaboration (Yjs over WebSockets). Node can hold WebSockets, so this is now possible.
3. **Browser extension clipper.** Full-page, simplified-article and screenshot modes, highlights, and "clip to notebook + tags" in one step. The bookmarklet already uses the API.
4. **Meeting capture.** Record or upload audio, transcribe it, then let AI produce a summary, decisions and action items as to-dos assigned to people with due dates. This links directly to the Tasks inbox.
5. **Semantic search.** Add embeddings next to keyword search, so "that note about the vendor contract" finds it without the exact words.
6. **SSO (SAML/OIDC) and SCIM.** Required by enterprise IT. Gate it behind the Enterprise plan.
7. **Granular page permissions.** Private pages inside a shared workspace, share a single page with a guest, and workspace "teamspaces".
8. **iOS app.** The sync protocol is platform-neutral, so this reuses the Android design.
9. **Linked databases and relations/rollups** (Notion's most-loved advanced features), plus formulas.
10. **Automations.** "When status → Done, set completed date", recurring tasks, Slack and Teams notifications, outgoing webhooks, and Zapier/Make apps (API tokens already exist).

## Differentiators that are hard to copy

- **Local-first privacy mode.** Optional end-to-end encryption per notebook (keys never leave devices). This is attractive to lawyers, therapists and journalists. It trades away server-side search and AI, so make it opt-in per notebook.
- **AI that works on your structure, not just text.** "Turn these meeting notes into a project database", "fill the Status column from the notes", "write the weekly update from everything that changed this week".
- **Daily review.** A morning email or push notification with today's tasks, reminders and pages updated by teammates since you last looked. It brings people back daily.
- **Handwriting and PDF annotation** on Android tablets, with OCR into searchable text.
- **Usage-based AI pricing.** Generous included credits per seat, then a pay-as-you-go top-up, so heavy AI users don't make the per-seat price too high for everyone else.

## Business model notes

- Free: 3 members and 250 MB, enough to fall in love but not to run a company on.
- Pro ($8/seat): small teams. Business ($15/seat): audit log, 1-year history and guests. Enterprise: SSO/SCIM, custom limits, a data-residency promise and invoicing. All of these are editable in Admin → Plans.
- Seats sync to Stripe automatically when members join or leave; guests are free, which encourages inviting clients in (viral loop).
- Published pages carry a small "Published with Pliopad" footer, a free acquisition channel.
