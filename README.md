# Pliopad

Notes and docs for teams: **Evernote-style capture** (notebooks, stacks, tags, a fast note list, reminders, document scanning, web clipper) combined with **Notion-style pages** (nested pages, a block editor, databases with Board/Table/Calendar/Gallery views). Sold as multi-tenant SaaS, with an enterprise admin console.

| Part | Where | Stack |
|---|---|---|
| API + web app + admin console | `server/` | Node.js 20+ (plain ES modules, no build step), MySQL/MariaDB (SQLite for local dev) |
| Web app | `server/public/app/` | Vanilla JS modules + CSS, served by the Node app at `/app/` |
| Admin console | `server/public/admin/` | Same toolkit, served at `/admin/` (platform admins only) |
| Android app | `android/` | Kotlin, Jetpack Compose, Room (offline-first), WorkManager sync, ML Kit scanner + OCR, Glance widget |

## What's in it

**Web app**
- Three panes like Evernote (sidebar → note list → editor). Pages outside notebooks open full-width like Notion, with a nested page tree in the sidebar.
- Block editor: `/` slash menu, Markdown shortcuts (`#`, `-`, `[]`, `>`, ```` ``` ````, `---`), to-dos, toggles, callouts, code, quotes, images and files (paste or drag and drop), bookmarks, sub-pages, `[[` page links with automatic **backlinks**, drag-to-reorder, block menu, bold/italic/code/link bubble.
- Databases: any page can be a database; rows are pages with typed properties (text, number, select, multi-select, status, date, person, checkbox, URL) and views (Table, Board with drag-and-drop, Calendar, Gallery, List), sorting and search.
- Search with operators: `tag:` `notebook:` `intitle:` `is:todo|done|pinned|db|reminder|shared` `has:image|file|code|link` `created:7d` `updated:2w` `-exclude` `"exact phrase"`. Text inside scanned images (OCR) is searchable.
- **Tasks inbox**: every open to-do from every note in one list; `@2026-11-03` sets a due date.
- Command palette (`Ctrl+K`), quick capture (`Alt+Q`), daily notes (`Alt+D`), templates, shortcuts, reminders, trash with undo, version history with restore, comments with @mentions, live presence and live refresh, publish to the web (`/s/…`, SEO-friendly), Markdown and PDF export, graph view, dark mode, PWA manifest.
- AI (Claude): summarize, action items, continue writing, improve selection, translate, tag and title suggestions, draft from a topic, and **Ask your notes** (answers with citations to your notes).
- Import from **Evernote (.enex)**, Notion (Markdown export) and HTML; export the whole workspace as JSON. Bookmarklet web clipper.
- Workspace settings: members, roles (owner/admin/member/guest), invitations, plan and billing (Stripe), audit log (Business plan), personal API tokens, sessions, two-factor (TOTP).

**Admin console** (`/admin/`): KPIs (MRR, users, MAU/DAU, workspaces, notes, storage, AI usage, 2FA adoption), sign-up and activity charts, tenants with plan changes, custom limits, suspend/reactivate and delete; users with disable, reset 2FA, revoke sessions, promote to platform admin, and **audited support sessions** ("sign in as user", with a required reason); a filterable audit log with CSV export; plan and Stripe price editor; settings for branding, sign-up policy (open, invite-only, closed, allowed email domains), SMTP, AI and Stripe; and a system health page.

**Android app**: offline-first (everything is in Room; edits sync in the background and merge block-by-block with edits from other devices), native block editor with a formatting bar, notebooks/tags/pages drawer, **document scanner with on-device OCR**, share-to-Pliopad from any app, home-screen widget (new note, scan, recent notes), reminders as local notifications, Tasks screen, local search, AI actions, database rows with editable properties, biometric app lock, workspace switcher.

**Server**: multi-tenant isolation on every query, bearer tokens (hashed at rest), scrypt passwords, TOTP 2FA, login throttling, signed file URLs, plan limits (members, storage, AI, history), Stripe Checkout/Portal/webhooks with seat sync, sequence-based incremental sync with tombstones, block-level merge, background jobs inside the process (reminder emails and notifications, trash purge after 30 days, history retention).

## Local development

Needs Node.js 22.5+ for the built-in SQLite driver (MySQL works on any Node 20+).

```bash
cd server
npm install
npm test
```

```bash
cd server
node src/server.js --config=dev-config.json
```

`dev-config.json` example:

```json
{ "app_key": "change-me", "debug": true, "port": 3000, "db": { "driver": "sqlite", "file": "dev.sqlite" }, "storage": "dev-files" }
```

Open http://localhost:3000/app/ and create an account. The first account becomes the platform admin; the admin console is at http://localhost:3000/admin/.

## Deploying to SiteGround

These steps assume your plan includes SiteGround's Node.js hosting. I couldn't check its exact screens, so names below may differ slightly.

1. **Database**: Site Tools → MySQL → create a database and a user with all privileges. Note the name, user and password.
2. **Upload** the `server/` folder (Git, SFTP or File Manager), for example to `~/pliopad`. Don't upload `node_modules`.
3. **Install dependencies** over SSH: `cd ~/pliopad && npm install --omit=dev`.
4. **Create the Node.js app** in Site Tools: application root `~/pliopad`, startup file `src/server.js`, and point your domain or subdomain at it. The app listens on the `PORT` SiteGround provides.
5. Open `https://your-domain/install` right away (until it's done, anyone who finds the address could run it), enter the database details and your admin account. This writes `config.json` (keep it private) and creates the tables.
6. In `/admin/#/settings`: set SMTP (Site Tools → Email → Accounts), an Anthropic API key for AI, and Stripe keys plus the webhook `https://your-domain/api/stripe/webhook` if you charge for plans.

**Keep data outside the app folder.** SiteGround deploys from an uploaded zip, and a redeploy can replace the app folder. Put `config.json` and `storage/` in a sibling folder such as `pliopad-data/`, and add two environment variables under Node.js → Deployment Options: `PLIOPAD_CONFIG=../pliopad-data/config.json` and `PLIOPAD_STORAGE=../pliopad-data/storage` (relative paths are resolved from the app folder). Back up that folder together with the database.

**Deploying from Git (recommended):** push this repository to a private GitHub repo and, in Node.js → Deployment Options, switch the deploy method to that repo and branch `main` with auto-deploy on. The root `package.json` installs the server (npm workspaces) and `npm start` runs it; if SiteGround asks for a startup file, use `server/src/server.js`. Keep your data in a folder named `pliopad-data` beside `public_html` (never inside it): `config.json`, `storage/` and `downloads/`. The server finds that folder by itself; Admin → System health shows which folders it is using. Every push to `main` then goes live.

**Updating from a zip instead:** zip the contents of `server/` (`node_modules`, `package.json`, `package-lock.json`, `public`, `src`; not `test`), then in Node.js → Deployment Options use the ⋮ menu on the archive to upload the new zip and choose **Save and Deploy**. That also restarts the app. Database changes run automatically on start. `/api/health` shows the running version.

Configuration can also come from environment variables, which take precedence over `config.json`: `PLIOPAD_APP_KEY`, `PLIOPAD_BASE_URL`, `PLIOPAD_STORAGE`, `PORT`, `ANTHROPIC_API_KEY`.

## Android

Open `android/` in Android Studio, or build from the command line with JDK 17 and the Android SDK (API 35):

```bash
cd android
./gradlew assembleRelease
```

On Windows, build output goes to `%LOCALAPPDATA%\PliopadBuild` to keep it out of OneDrive. The release build is signed with the debug key so it installs right away; use your own signing key before publishing to the Play Store. To prefill the server address on the sign-in screen, add `PLIOPAD_SERVER=https://your-domain` to `android/local.properties`.

## AI

AI features call Claude (`claude-opus-5-5` by default; you can change it in Admin → Settings) through the official `@anthropic-ai/sdk`, with the server-side refusal fallback turned on. Every request counts against the workspace's monthly AI allowance, which is set per plan. Without an API key, AI buttons are hidden.

See [ROADMAP.md](ROADMAP.md) for the competitive-edge features that are built and the ones planned next.
