// The Help center's starting articles, copied into the database the first time the server starts.
// After that they're edited in the admin console (Help articles), and the apps load them from GET /api/help.
// Bodies are short paragraphs separated by blank lines; a line starting with "- " is a list item.

export const CATEGORIES = [
  { id: 'start', name: 'Getting started', icon: '🚀' },
  { id: 'notes', name: 'Notes & notebooks', icon: '📓' },
  { id: 'home', name: 'Home & PlioSphere', icon: '🪐' },
  { id: 'apps', name: 'Apps, sync & offline', icon: '🔄' },
  { id: 'account', name: 'Account & billing', icon: '👤' },
];

export const ARTICLES = [
  { id: 'welcome', category: 'start', title: 'What is PlioPad?', body: `PlioPad keeps quick notes, longer pages and databases in one place, and connects them so you can find your way back to anything.

- Jot something down in seconds with Quick jot, Quick capture or the Android widgets.
- Shape notes into pages with headings, to-dos, tables and images.
- Organise pages into notebooks, and group notebooks into collections.
- See how everything relates in PlioSphere.

Your notes sync between the web app, Windows and Android, and the apps keep working offline.` },
  { id: 'first-steps', category: 'start', title: 'Your first five minutes', body: `1. Open Home and type into Quick jot. It saves as you type.
2. Press New note to start a page. Type / on an empty line to insert a heading, to-do, table or image.
3. Create a notebook from the sidebar (the + next to Notebooks) and move notes into it.
4. Add [ ] to any line to make a to-do. Every open to-do appears in Tasks.
5. Install the Windows or Android app from the website so your notes are with you everywhere.` },
  { id: 'notebooks', category: 'notes', title: 'Notebooks, collections and the Inbox', body: `Every page lives in a notebook. Collections group related notebooks together in the sidebar (for example, a "Work" collection holding "Clients" and "Projects").

The Inbox is your default notebook: anything you create without choosing a notebook lands there, including Quick capture, the Android widgets, voice notes, scans and the web clipper. Move notes out of the Inbox whenever you like.

Sub-pages and database rows always stay in the same notebook as the page they belong to.` },
  { id: 'editor', category: 'notes', title: 'Writing and formatting', body: `Type / on an empty line for the block menu: headings, lists, to-dos, quotes, code, tables, images and more.

- Markdown shortcuts work too: # for a heading, - for a bullet, [ ] for a to-do.
- Type [[ to link to another page. Linked pages show backlinks.
- Add @2026-11-01 to a to-do to give it a due date.
- Tap or click anywhere in the empty space below a note to keep typing.

You can change a note's created date from its menu.` },
  { id: 'tasks', category: 'notes', title: 'Tasks and reminders', body: `Any line starting with [ ] is a to-do. Tasks gathers every open to-do from all your notes, grouped into overdue, today, upcoming and no date.

Set a reminder on a note from its menu. PlioPad notifies you at that time on your devices, even when the Android app is offline.` },
  { id: 'databases', category: 'notes', title: 'Databases', body: `A database is a page made of rows, with properties such as status, dates and people. View the same rows as a table, a board grouped by status, or a calendar.

Each row is a page of its own, so it can hold notes, to-dos and images.` },
  { id: 'home', category: 'home', title: 'Customising Home', body: `Home is your dashboard. Press Edit to change it:

- Drag a card by its handle to move it.
- Use the eye to hide or show a card. Hidden cards stay dimmed while editing so you can bring them back.
- On a foldable's unfolded screen (or a tablet), make cards half or full width; half-width cards sit side by side.

Your layout is saved to your account. Phones, the web and Windows share one layout; the unfolded screen keeps its own.` },
  { id: 'pliosphere', category: 'home', title: 'PlioSphere', body: `PlioSphere is a 3D map of your notes. Each point is a note and each thread is a connection.

- Solid threads are links you made yourself: [[links]] and sub-pages.
- Dashed mint threads are links PlioPad discovered: notes that mention each other, share a tag or use similar wording. Select a note to see why it's connected.

Drag to spin, pinch or scroll to zoom, tap a note to select it and tap again to open it. Turn discovered links off with the toggle.` },
  { id: 'sync', category: 'apps', title: 'How sync works', body: `Every app keeps a full copy of your notes on the device, so you can read and write offline. Changes sync in the background whenever you're online.

If two devices edit different parts of the same note, both edits are kept. On Android, tap the cloud icon at the top of a list to sync right away and see whether anything didn't sync.` },
  { id: 'apps', category: 'apps', title: 'Installing the apps', body: `Download the Windows installer or the Android app from the PlioPad website, then sign in with your PlioPad account.

- Windows: run the installer. Press Ctrl+Alt+N anywhere in Windows for Quick capture.
- Android: allow installs from your browser when asked. Add the PlioPad widgets to your home screen for one-tap capture.

The apps update by installing the newer version over the old one; your notes stay on the device and in your account.` },
  { id: 'maintenance', category: 'apps', title: '"PlioPad is down for maintenance"', body: `Occasionally PlioPad is taken offline briefly for upgrades. The web app shows a notice with the expected return time and reloads itself when PlioPad is back.

The Windows and Android apps keep working offline during maintenance and sync your changes afterwards.` },
  { id: 'account', category: 'account', title: 'Your account and security', body: `Change your name, password and two-step sign-in from Settings in the web app.

Signing out of one device doesn't affect the others. If you think someone else has access to your account, change your password: that signs out every other device.` },
  { id: 'workspaces', category: 'account', title: 'Workspaces, members and plans', body: `A workspace holds a set of notebooks. Invite people to a workspace from Settings & members to share it with them, and choose what each person can do.

Your plan decides limits such as storage and members. Change plans from Settings → Billing in the web app.` },
];
