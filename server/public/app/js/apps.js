// "Get the apps": native downloads for Windows, Android and macOS, offered from the web app.
// The server lists whatever builds are in public/downloads/, so publishing a new version is just replacing a file.
import { h, icon, modal, toast } from './ui.js';
import { api } from './api.js';

const ICONS = { windows: '🪟', android: '🤖', mac: '🍎' };

/** The visitor's own platform comes first and is highlighted. */
function myPlatform() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  return null;
}

const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export async function appsDialog() {
  let apps;
  try { apps = await api('GET', '/downloads'); } catch (e) { toast(e.message, { error: true }); return; }
  const mine = myPlatform();
  apps.sort((a, b) => (b.id === mine) - (a.id === mine) || b.available - a.available);
  const body = h('div', { class: 'apps' },
    h('p', { class: 'muted', style: { margin: '0 0 14px' } }, 'Native apps that work offline and sync with this workspace. Sign in with the same email and password.'),
    apps.map((a) => h('div', { class: 'app-card' + (a.id === mine ? ' mine' : '') },
      h('div', { class: 'app-ico' }, ICONS[a.id] || '💻'),
      h('div', { class: 'grow' },
        h('div', { class: 'app-name' }, `Pliopad for ${a.name}`, a.id === mine ? h('span', { class: 'app-tag' }, 'This device') : null),
        h('div', { class: 'muted app-meta' }, a.available ? [a.version ? `Version ${a.version}` : null, size(a.size), a.note].filter(Boolean).join(' · ') : 'Coming soon')),
      a.available
        ? h('a', { class: 'btn' + (a.id === mine ? ' primary' : ''), href: a.url, download: '' }, icon('download'), 'Download')
        : h('button', { class: 'btn', disabled: true }, 'Soon'))),
    h('p', { class: 'muted', style: { margin: '14px 0 0', fontSize: '12px' } },
      'Windows may show “Windows protected your PC” the first time: choose More info → Run anyway. ',
      'On Android, allow your browser to install apps when prompted.'));
  modal('Get the Pliopad apps', body, { wide: true });
}
