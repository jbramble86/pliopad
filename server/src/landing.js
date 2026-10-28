// The public website at "/": the product story, with the live knowledge graph as the centerpiece.
// Brand: Midnight Navy #101D59, Periwinkle #647BFF, Mint #83EBC0, Soft Ivory #FAF9F5.
import { escapeHtml as e, setting } from './util.js';
import { allPlans } from './plans.js';

const MARK = `<svg viewBox="18 12 182 252" aria-hidden="true"><path fill="#647BFF" d="M24 18H121C165 18 193 48 193 91C193 137 160 162 115 162H100V223L24 258Z"/><path fill="#101D59" d="M24 18H119C167 18 193 47 193 92C193 133 163 161 116 161H100V117C100 105 92 94 79 84Z"/><path fill="#83EBC0" d="M24 223C24 189 52 162 88 162H100V223L33 256C28 259 24 256 24 249Z"/></svg>`;
const MARK_ON_NAVY = MARK.replace('fill="#101D59"', 'fill="#293C91"');

const CSS = `
:root{--navy:#101D59;--navy2:#172670;--peri:#647BFF;--mint:#83EBC0;--ivory:#FAF9F5;--ink:#101D59;--text:#2B3256;--muted:#5D6485;--line:#E6E4DC;--card:#fff}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--ivory);color:var(--text);font:17px/1.6 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}img,svg{display:block}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
h1,h2,h3{color:var(--ink);letter-spacing:-.025em;line-height:1.1;margin:0}
h2{font-size:clamp(30px,4.2vw,46px)}h3{font-size:20px;letter-spacing:-.01em}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--peri)}
.lead{font-size:19px;color:var(--muted);max-width:620px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:12px;font-weight:600;font-size:16px;text-decoration:none;border:0;cursor:pointer;transition:transform .15s,box-shadow .15s,background .15s}
.btn:hover{transform:translateY(-1px)}
.btn.primary{background:var(--peri);color:#fff;box-shadow:0 8px 24px -8px rgba(100,123,255,.7)}
.btn.mint{background:var(--mint);color:var(--navy)}
.btn.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--line)}
.btn.ghost.light{color:#fff;border-color:rgba(255,255,255,.25)}
/* nav */
header{position:sticky;top:0;z-index:20;background:rgba(250,249,245,.82);backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid transparent;transition:border-color .2s}
header.scrolled{border-bottom-color:var(--line)}
nav{display:flex;align-items:center;gap:28px;height:68px}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:800;font-size:23px;letter-spacing:-.04em;color:var(--navy)}.logo svg{height:30px;width:auto}.logo b{color:var(--peri);font-weight:800}
.links{display:flex;gap:24px;margin-left:12px}.links a{text-decoration:none;color:var(--muted);font-weight:500;font-size:15px}.links a:hover{color:var(--ink)}
nav .right{margin-left:auto;display:flex;gap:10px;align-items:center}nav .btn{padding:9px 16px;font-size:15px}
/* hero */
.hero{background:radial-gradient(1200px 600px at 75% 10%,#22348f 0%,transparent 60%),var(--navy);color:#fff;overflow:hidden;position:relative}
.hero .wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:40px;align-items:center;padding-top:72px;padding-bottom:88px}
.hero h1{color:#fff;font-size:clamp(42px,6vw,72px);letter-spacing:-.035em}
.hero h1 em{font-style:normal;background:linear-gradient(90deg,var(--mint),var(--peri));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero .lead{color:#C9CFEA;margin:22px 0 30px}
.hero .eyebrow{color:var(--mint)}
.cta{display:flex;flex-wrap:wrap;gap:12px}
.trust{margin-top:22px;font-size:14px;color:#9BA4D0;display:flex;gap:18px;flex-wrap:wrap}.trust span::before{content:"✓ ";color:var(--mint)}
.graph-card{position:relative;height:540px;border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.1);box-shadow:0 40px 80px -30px rgba(0,0,0,.6);overflow:hidden}
.graph-card canvas{width:100%;height:100%;cursor:grab}.graph-card canvas.drag{cursor:grabbing}
.graph-bar{position:absolute;top:14px;left:16px;right:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:#AEB6E0;pointer-events:none}
.graph-bar .dots{display:flex;gap:6px}.graph-bar .dots i{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.18)}
.legend{position:absolute;left:16px;bottom:14px;display:flex;gap:14px;font-size:12.5px;color:#AEB6E0;pointer-events:none;flex-wrap:wrap}.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:1px}
.peek{position:absolute;width:250px;padding:14px 16px;border-radius:14px;background:var(--ivory);color:var(--text);box-shadow:0 18px 40px -12px rgba(0,0,0,.5);font-size:13.5px;line-height:1.45;pointer-events:none;opacity:0;transform:translateY(6px);transition:opacity .15s,transform .15s}
.peek.on{opacity:1;transform:none}.peek b{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}.peek small{display:block;margin-top:8px;color:var(--peri);font-weight:600}
.hint{position:absolute;right:16px;bottom:14px;font-size:12.5px;color:#7F89BD;pointer-events:none}
/* sections */
section{padding:104px 0}
.center{text-align:center}.center .lead{margin:16px auto 0}
.platforms{padding:28px 0;border-bottom:1px solid var(--line);background:#fff}
.platforms .wrap{display:flex;align-items:center;justify-content:center;gap:42px;flex-wrap:wrap;color:var(--muted);font-weight:600;font-size:15px}
.platforms span{display:flex;align-items:center;gap:8px}.platforms em{font-style:normal;font-weight:500;font-size:12px;padding:2px 8px;border-radius:20px;background:#EEF0FF;color:var(--peri)}
.trio{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:56px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px}
.tile .ico{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:22px;margin-bottom:18px;background:#EEF0FF}
.tile p{color:var(--muted);margin:8px 0 0;font-size:15.5px}
kbd{font:600 13px/1 ui-monospace,Consolas,monospace;padding:3px 7px;border-radius:6px;background:#EEF0FF;color:var(--peri);border:1px solid #DDE2FF}
.row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:72px;align-items:center;margin-top:112px}
.row:first-of-type{margin-top:64px}
.row.flip .copy{order:2}
.copy h2{font-size:clamp(28px,3.4vw,40px)}.copy .lead{margin-top:16px;font-size:18px}
.ticks{list-style:none;padding:0;margin:22px 0 0}.ticks li{padding:7px 0 7px 30px;position:relative;color:var(--text)}
.ticks li::before{content:"";position:absolute;left:0;top:12px;width:18px;height:18px;border-radius:6px;background:var(--mint) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23101D59' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5 9-10'/%3E%3C/svg%3E") center/12px no-repeat}
/* product mocks */
.mock{background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 30px 60px -30px rgba(16,29,89,.35);padding:22px;position:relative}
.mock .t{font-weight:700;color:var(--ink);font-size:20px;margin-bottom:12px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:7px;font-size:13px;font-weight:500}
.cap{display:flex;flex-direction:column;gap:10px}
.cap .box{border:1.5px solid var(--peri);border-radius:14px;padding:14px 16px;font-size:15px;color:var(--text);box-shadow:0 0 0 5px rgba(100,123,255,.12)}
.cap .meta{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted)}
.blk{display:flex;gap:10px;align-items:flex-start;padding:4px 0;font-size:15px}.blk .cb{width:17px;height:17px;border:1.5px solid #B9BED6;border-radius:4px;flex:none;margin-top:3px}.blk .cb.on{background:var(--peri);border-color:var(--peri)}
.blk.done span{color:#9AA0BC;text-decoration:line-through}
.slash{position:absolute;right:-18px;bottom:28px;width:230px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 20px 40px -14px rgba(16,29,89,.35);padding:8px;font-size:14px}
.slash div{padding:7px 10px;border-radius:8px;display:flex;gap:10px;align-items:center}.slash div.on{background:#EEF0FF}.slash b{width:26px;height:26px;border-radius:7px;border:1px solid var(--line);display:grid;place-items:center;font-size:12px;color:var(--ink)}
.board{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.col h4{margin:0 0 10px;font-size:13px;font-weight:600}
.card{background:var(--ivory);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px;font-size:14px;color:var(--ink);font-weight:600}
.card small{display:block;color:var(--muted);font-weight:500;margin-top:4px}
.ask .q{background:var(--navy);color:#fff;border-radius:16px 16px 4px 16px;padding:12px 16px;margin-left:auto;max-width:80%;font-size:15px}
.ask .a{background:var(--ivory);border:1px solid var(--line);border-radius:16px 16px 16px 4px;padding:14px 16px;margin-top:14px;font-size:15px;max-width:92%}
.ask .src{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.ask sup{color:var(--peri);font-weight:700}
.devices{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;justify-content:center;min-width:0}
.dev{background:var(--navy);border-radius:22px;padding:10px;box-shadow:0 30px 60px -30px rgba(16,29,89,.6)}
.dev .scr{background:#fff;border-radius:14px;height:100%;display:grid;gap:6px;padding:10px}
.dev .scr i{display:block;border-radius:6px;background:#EEF0FF}
.dev.fold{width:220px;height:186px}.dev.fold .scr{grid-template-columns:.8fr 1fr 1.6fr}
.dev.phone{width:84px;height:170px;border-radius:16px;padding:7px}.dev.desk{width:230px;height:160px;border-radius:14px}.dev.desk .scr{grid-template-columns:.7fr 1fr 2fr}
.dev .scr i.p{background:var(--peri);opacity:.75}.dev .scr i.m{background:var(--mint)}
.dev small{display:block;text-align:center;color:#AEB6E0;font-size:12px;margin-top:8px}
/* grid of extras */
.grid6{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:56px}
.grid6 .tile{padding:24px}.grid6 h3{font-size:17px}
/* apps */
.apps{background:var(--navy);color:#fff;border-radius:32px;padding:64px;display:grid;grid-template-columns:1fr 1.2fr;gap:48px;align-items:center}
.apps h2{color:#fff}.apps .lead{color:#C9CFEA}
.dl{display:grid;gap:12px}
.dl>a,.dl>div{display:flex;align-items:center;gap:16px;padding:16px 18px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);text-decoration:none;color:#fff;transition:background .15s}
.dl>a:hover{background:rgba(255,255,255,.12)}.dl .i{font-size:28px}.dl b{display:block;font-size:16px}.dl small{color:#AEB6E0;font-size:13px}.dl .go{margin-left:auto;font-weight:600;color:var(--mint);white-space:nowrap}
.dl .soon{opacity:.6}.dl .mine{border-color:var(--mint);background:rgba(131,235,192,.08)}
/* pricing */
.seg{display:flex;width:max-content;margin:36px auto 0;padding:5px;border-radius:14px;background:#EEECE6;gap:4px}.seg button{border:0;background:none;font:600 15px Inter,system-ui,sans-serif;color:var(--muted);padding:9px 22px;border-radius:10px;cursor:pointer}.seg button[aria-selected=true]{background:#fff;color:var(--ink);box-shadow:0 2px 8px -2px rgba(16,29,89,.2)}
.plans{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:36px auto 0}.plans[hidden]{display:none}.plans.n2{grid-template-columns:repeat(2,1fr);max-width:760px}.plans.n3{grid-template-columns:repeat(3,1fr);max-width:1000px}
.plan{background:#fff;border:1px solid var(--line);border-radius:22px;padding:28px;display:flex;flex-direction:column}
.plan.best{border:2px solid var(--peri);box-shadow:0 30px 60px -30px rgba(100,123,255,.6);position:relative}
.plan.best::before{content:"Most popular";position:absolute;top:-13px;left:24px;background:var(--peri);color:#fff;font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px}
.plan .price{font-size:40px;font-weight:800;color:var(--ink);letter-spacing:-.03em;margin:12px 0 2px}.plan .price small{font-size:15px;font-weight:500;color:var(--muted);letter-spacing:0}
.plan ul{list-style:none;padding:0;margin:18px 0 24px;font-size:14.5px;flex:1}.plan li{padding:5px 0 5px 24px;position:relative}.plan li::before{content:"✓";position:absolute;left:0;color:var(--peri);font-weight:700}
.plan .btn{justify-content:center}
/* faq */
.faq{max-width:780px;margin:48px auto 0}
details{border-bottom:1px solid var(--line);padding:20px 4px}summary{cursor:pointer;font-weight:600;color:var(--ink);font-size:18px;list-style:none;display:flex;justify-content:space-between;gap:16px}
summary::after{content:"+";color:var(--peri);font-size:24px;line-height:1}details[open] summary::after{content:"–"}details p{color:var(--muted);margin:12px 0 0}
/* final */
.final{background:var(--navy);color:#fff;text-align:center;padding:110px 0;position:relative;overflow:hidden}
.final h2{color:#fff;font-size:clamp(34px,5vw,56px)}.final .lead{color:#C9CFEA;margin:18px auto 32px}.final .cta{justify-content:center}
.final .mk{position:absolute;right:-60px;bottom:-80px;width:340px;opacity:.12}
footer{background:var(--navy);color:#8E97C6;border-top:1px solid rgba(255,255,255,.08);padding:36px 0;font-size:14px}
footer .wrap{display:flex;gap:24px;align-items:center;flex-wrap:wrap}footer a{text-decoration:none}footer a:hover{color:#fff}footer .logo{color:#fff;font-size:19px}footer .logo svg{height:24px}
.reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease}.reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}html{scroll-behavior:auto}}
@media (max-width:960px){
  .plans.n2,.plans.n3{grid-template-columns:1fr 1fr}
  .links{display:none}.hero .wrap,.row,.apps{grid-template-columns:1fr}.row.flip .copy{order:0}.row{gap:36px;margin-top:80px}
  .trio,.grid6{grid-template-columns:1fr}.plans{grid-template-columns:1fr 1fr}.graph-card{height:420px}.apps{padding:36px 24px}.slash{right:8px}
  section{padding:76px 0}.devices{transform:scale(.8)}
}
@media (max-width:560px){.plans,.plans.n2,.plans.n3{grid-template-columns:1fr}.legend{bottom:36px}.hint{display:none}.wrap{padding:0 16px}nav .btn.ghost{display:none}.devices .phone{display:none}.board{grid-template-columns:1fr 1fr}.board .col:last-child{display:none}}
`;

// Demo workspace for the hero graph: three areas of a life, with notes that link across them.
const GRAPH = `[
["Q4 launch plan","w",["Roadmap","Pricing","Launch post","Weekly sync","Customer interviews"],"Goals, owners and dates for the launch. Links to pricing, the roadmap and every meeting that shaped it."],
["Roadmap","w",["Android offline sync","Windows app","Graph view","Q4 launch plan"],"A database: Board, Table and Calendar views of everything shipping this quarter."],
["Weekly sync","w",["Q4 launch plan","Hiring","Customer interviews"],"Running notes from every Monday. Action items become tasks with due dates."],
["Customer interviews","w",["Pricing","Feature requests","Weekly sync"],"Twelve conversations, tagged by theme. Ask AI pulls quotes out with citations."],
["Pricing","w",["Customer interviews","Q4 launch plan"],"Free, Pro and Business: what each includes and why."],
["Launch post","w",["Q4 launch plan","Brand guide"],"Draft blog post for launch day."],
["Hiring","w",["Weekly sync","Interview kit"],"Open roles and the scorecard for each."],
["Interview kit","w",["Hiring"],"A template: questions, rubric, notes."],
["Feature requests","w",["Customer interviews","Graph view","Roadmap"],"Everything customers asked for, ranked."],
["Graph view","w",["Roadmap","Feature requests"],"See how every note connects. You are looking at it."],
["Android offline sync","w",["Roadmap"],"Sync design: block-level merging, so two devices never overwrite each other."],
["Windows app","w",["Roadmap"],"Native WinUI client with quick capture from anywhere."],
["Brand guide","w",["Launch post"],"Midnight Navy, Periwinkle, Mint and Soft Ivory."],
["Thesis outline","r",["Reading list","Literature notes","Interview transcripts","Chapter 2"],"Structure for the whole thesis, with links to every source."],
["Reading list","r",["Thesis outline","Literature notes"],"Papers to read, with status in a database."],
["Literature notes","r",["Reading list","Thesis outline","Chapter 2","Customer interviews"],"One note per paper. Backlinks show where each one is cited."],
["Chapter 2","r",["Thesis outline","Literature notes"],"Draft. Ask AI: what did I conclude about memory?"],
["Interview transcripts","r",["Thesis outline"],"Scanned and searchable, including handwriting."],
["Daily note · Mon","p",["Weekly sync","Gym plan","Trip to Lisbon"],"Top three today, notes, wins."],
["Daily note · Tue","p",["Thesis outline","Recipes","Daily note · Mon"],"Morning pages and a to-do list."],
["Trip to Lisbon","p",["Packing list","Budget","Daily note · Mon"],"Flights, bookings and the restaurant list."],
["Packing list","p",["Trip to Lisbon"],"A checklist you reuse every trip."],
["Budget","p",["Trip to Lisbon","Recipes"],"Monthly budget table."],
["Recipes","p",["Budget","Daily note · Tue"],"Clipped from the web, tagged by cuisine."],
["Gym plan","p",["Daily note · Mon"],"Three days a week."]
]`;

const FAQ = [
  ['How is PlioPad different from Evernote or Notion?', 'PlioPad pairs fast, notebook-based capture with pages, blocks and databases, and then shows you how it all connects in a live graph. It also ships real native apps for Windows and Android that work fully offline and merge edits block by block when you reconnect.'],
  ['Do the apps work offline?', 'Yes. The Windows and Android apps keep your notes on the device. You can write, search and organize without a connection, and everything syncs when you are back online. If two people edited the same note, PlioPad merges their changes block by block instead of overwriting.'],
  ['What is the graph?', 'Every time you link one note to another (type [[ in any note) PlioPad draws that connection. The graph shows your whole workspace as a map: clusters form around projects, and forgotten notes resurface because they link to what you are working on now.'],
  ['Is my data private?', 'Your workspace is private to its members. Sign-ins use hashed passwords with optional two-factor authentication, and you can export everything at any time. Teams on Business get an audit log of every sensitive action.'],
  ['Can I import my notes?', 'Yes. Import Markdown and Evernote exports from Settings, or paste text straight into a page: headings, lists and to-dos are converted automatically.'],
  ['Which devices are supported?', 'Any modern browser, Windows 10 and 11, and Android 8 or newer, with a layout built for foldables and tablets. A native Mac app is on the way.'],
];

function planCard(k, p, best) {
  const gb = (mb) => (mb >= 1048576 ? `${Math.round(mb / 1048576)} TB` : mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${mb} MB`);
  const people = (n) => (n >= 100000 ? 'Unlimited members' : n === 1 ? 'Just you' : `Up to ${n} members`);
  const blurbs = {
    free: 'Everything you need to start. Share with up to two others.',
    personal: 'For your second brain: more space, more AI, longer history.',
    pro: 'For teams who plan, write and decide together.',
    business: 'For growing companies that need control and compliance.',
    enterprise: 'For organizations with advanced security and scale.',
  };
  const per = p.per === 'month' ? ' /month' : ' /member/mo';
  const cta = k === 'enterprise' ? ['Contact sales', 'mailto:' + e(setting('support_email', 'hello@pliopad.com'))] : [k === 'free' ? 'Start free' : `Get ${e(p.name)}`, '/app/#/signup'];
  return `<div class="plan${best ? ' best' : ''}">
<h3>${e(p.name)}</h3><p style="color:var(--muted);font-size:14.5px;margin:6px 0 0;min-height:44px">${blurbs[k] || ''}</p>
<div class="price">${p.price == null ? 'Custom' : p.price === 0 ? '$0' : `$${p.price}<small>${per}</small>`}</div>
<ul><li>${people(p.members)}</li><li>${gb(p.storage_mb)} storage</li><li>${Number(p.ai_per_month).toLocaleString('en-US')} AI requests a month</li><li>${p.history_days >= 365 ? Math.round(p.history_days / 365) + '-year' : p.history_days + '-day'} page history</li>
<li>Graph, offline Windows &amp; Android apps</li>${p.guests ? '<li>Share pages with guests</li>' : ''}${p.audit ? '<li>Audit log &amp; admin controls</li>' : ''}</ul>
<a class="btn ${best ? 'primary' : 'ghost'}" href="${cta[1]}">${cta[0]}</a></div>`;
}

/** Two sets of plans behind a Personal / Teams switch. Free appears in both. */
function plansHtml() {
  const plans = Object.entries(allPlans());
  const group = (aud) => plans.filter(([, p]) => p.audience === aud || p.audience === 'both' || (!p.audience && aud === 'team'));
  const personal = group('personal'), team = group('team');
  return `<div class="seg" role="tablist"><button role="tab" aria-selected="true" data-aud="personal">Personal</button><button role="tab" aria-selected="false" data-aud="team">Teams</button></div>
<div class="plans n${personal.length}" data-aud="personal">${personal.map(([k, p]) => planCard(k, p, k === 'personal')).join('')}</div>
<div class="plans n${team.length}" data-aud="team" hidden>${team.map(([k, p]) => planCard(k, p, k === 'pro')).join('')}</div>`;
}

export function renderLanding(res) {
  const app = e(setting('app_name', 'PlioPad'));
  const wordmark = app === 'PlioPad' || app === 'Pliopad' ? 'Plio<b>Pad</b>' : app;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${app} · Every note, connected</title>
<meta name="description" content="Capture like Evernote, organize like Notion, and see how it all connects in a live graph. Native apps for Windows and Android that work offline.">
<meta property="og:title" content="${app} · Every note, connected"><meta property="og:description" content="Notes, docs and databases that link themselves into a living map of your work. Web, Windows and Android.">
<meta name="theme-color" content="#101D59"><link rel="icon" href="/brand/PlioPad-mark.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>

<header id="top"><div class="wrap"><nav>
<a class="logo" href="/">${MARK}<span>${wordmark}</span></a>
<div class="links"><a href="#graph">Graph</a><a href="#features">Features</a><a href="#apps">Apps</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></div>
<div class="right"><a class="btn ghost" href="/app/#/login">Sign in</a><a class="btn primary" href="/app/#/signup">Start free</a></div>
</nav></div></header>

<div class="hero"><div class="wrap">
<div>
<span class="eyebrow">● Notes that connect themselves</span>
<h1>Every note,<br><em>connected.</em></h1>
<p class="lead">Capture like Evernote. Organize like Notion. Then watch ${app} turn your notes into a living map of everything you know, so the right idea is always one link away.</p>
<div class="cta"><a class="btn primary" href="/app/#/signup">Start free</a><a class="btn ghost light" href="#apps">Get the apps</a></div>
<div class="trust"><span>Free for up to 3 people</span><span>Works offline</span><span>Web · Windows · Android</span></div>
</div>
<div class="graph-card" id="graph-card">
<div class="graph-bar"><div class="dots"><i></i><i></i><i></i></div><span>Graph · Your workspace</span></div>
<canvas id="graph" aria-label="Interactive graph of linked notes"></canvas>
<div class="peek" id="peek"></div>
<div class="legend"><span><i style="background:#647BFF"></i>Work</span><span><i style="background:#83EBC0"></i>Research</span><span><i style="background:#F4D6A0"></i>Personal</span></div>
<div class="hint">Hover a note · drag to rearrange</div>
</div>
</div></div>

<div class="platforms"><div class="wrap">
<span>🌐 Web</span><span>🪟 Windows</span><span>🤖 Android</span><span>📱 Foldables &amp; tablets</span><span>🍎 Mac <em>Coming soon</em></span>
</div></div>

<section id="graph"><div class="wrap center reveal">
<span class="eyebrow">The graph</span>
<h2 style="margin-top:12px">See how your ideas connect.</h2>
<p class="lead">Folders hide things. Links surface them. Every [[link]] you type becomes a thread in your graph, so meetings lead to decisions, decisions lead to projects, and nothing you write is ever lost in a folder again.</p>
<div class="trio">
<div class="tile reveal"><div class="ico">🔗</div><h3>Link as you type</h3><p>Type <kbd>[[</kbd> in any note to link another, or create it on the spot. No setup, no tagging rituals.</p></div>
<div class="tile reveal"><div class="ico">↩️</div><h3>Backlinks, automatically</h3><p>Every note shows what links to it. Open a project and see every meeting, doc and idea that mentioned it.</p></div>
<div class="tile reveal"><div class="ico">✨</div><h3>Clusters you didn't plan</h3><p>Related notes pull together on the graph. Spot themes across projects, and rediscover notes from months ago.</p></div>
</div></div></section>

<section id="features" style="padding-top:0"><div class="wrap">

<div class="row reveal"><div class="copy">
<span class="eyebrow">Capture</span><h2 style="margin-top:12px">Get it down before it's gone.</h2>
<p class="lead">The fastest way from thought to note, wherever you are.</p>
<ul class="ticks"><li>Press <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd> anywhere in Windows for quick capture</li><li>Scan paper and whiteboards on Android; text inside them becomes searchable</li><li>Home-screen widgets for quick notes, tasks and a pinned note</li><li>Clip from the web, share from any app, or jot in the scratch pad</li></ul>
</div><div class="mock cap">
<div class="t" style="font-size:15px;color:var(--muted);font-weight:600">⚡ Quick capture</div>
<div class="box">Call Dana about the Lisbon venue<br>- [ ] Send the deposit @Friday<br><span style="color:#B3B8D0">Ctrl+Enter to save</span></div>
<div class="meta"><span class="chip" style="background:#EEF0FF;color:var(--peri)">📥 Inbox</span><span>Syncs to your phone in seconds</span></div>
</div></div>

<div class="row flip reveal"><div class="copy">
<span class="eyebrow">Write &amp; organize</span><h2 style="margin-top:12px">Pages that do more than hold text.</h2>
<p class="lead">A block editor that gets out of your way, with databases built in.</p>
<ul class="ticks"><li>Type <kbd>/</kbd> for headings, to-dos, toggles, callouts, code and images</li><li>Notebooks and stacks for structure; tags and links for everything else</li><li>Databases with Board, Table and Calendar views. Every row is a page.</li><li>To-dos from every note roll up into one Tasks view, sorted by due date</li></ul>
</div><div class="mock">
<div class="t">🗺️ Product roadmap</div>
<div class="board">
<div class="col"><h4><span class="chip" style="background:#EEECE6">Not started</span></h4><div class="card">Customer interviews<small>Nov 11 · Dana</small></div><div class="card">Pricing page<small>Nov 18</small></div></div>
<div class="col"><h4><span class="chip" style="background:#E3E8FF;color:#3346c4">In progress</span></h4><div class="card">Windows beta<small>Today · Jeremy</small></div></div>
<div class="col"><h4><span class="chip" style="background:#DDF8EC;color:#1d7a55">Done</span></h4><div class="card">Offline sync<small>Oct 25</small></div><div class="card">Graph view<small>Oct 20</small></div></div>
</div>
<div class="slash"><div class="on"><b>☑</b>To-do list</div><div><b>H1</b>Heading 1</div><div><b>▦</b>Database</div><div><b>💡</b>Callout</div></div>
</div></div>

<div class="row reveal"><div class="copy">
<span class="eyebrow">Ask AI</span><h2 style="margin-top:12px">Ask your notes anything.</h2>
<p class="lead">An assistant that answers from <em>your</em> workspace and shows its sources, so you can trust what it says.</p>
<ul class="ticks"><li>Answers cite the exact notes they came from</li><li>Summarize long pages, pull out action items, suggest titles</li><li>Draft outlines and continue writing in your voice</li></ul>
</div><div class="mock ask">
<div class="q">What did customers say about pricing?</div>
<div class="a">Most teams found Pro fair at $8 per member<sup>1</sup>, but three asked for annual billing<sup>2</sup>. Two smaller teams wanted a cheaper plan for under five people<sup>1</sup>.
<div class="src"><span class="chip" style="background:#EEF0FF;color:var(--peri)">[1] Customer interviews</span><span class="chip" style="background:#EEF0FF;color:var(--peri)">[2] Weekly sync</span></div></div>
</div></div>

<div class="row flip reveal"><div class="copy">
<span class="eyebrow">Everywhere</span><h2 style="margin-top:12px">Native on every screen. Fully offline.</h2>
<p class="lead">Real apps, not web pages in a frame. Your notes live on your devices and sync in the background.</p>
<ul class="ticks"><li>A three-pane layout made for foldables and tablets, with continuity when you unfold</li><li>A native Windows app with multiple windows, a command palette and reminders</li><li>Edit on two devices offline; changes merge block by block, nothing is overwritten</li></ul>
</div><div class="devices">
<div><div class="dev phone"><div class="scr" style="grid-template-rows:20px 1fr 1fr 1fr"><i class="p"></i><i></i><i></i><i class="m"></i></div></div></div>
<div><div class="dev fold"><div class="scr"><i></i><i></i><i class="p" style="opacity:.25"></i></div></div><small>Unfolded: sidebar, list and page</small></div>
<div><div class="dev desk"><div class="scr"><i></i><i></i><i class="m" style="opacity:.45"></i></div></div><small>Windows</small></div>
</div></div>

<div class="grid6">
<div class="tile reveal"><div class="ico">🔎</div><h3>Search that understands you</h3><p>Filters like <kbd>tag:</kbd>, <kbd>notebook:</kbd> and <kbd>is:todo</kbd>, plus text inside scanned images.</p></div>
<div class="tile reveal"><div class="ico">🏡</div><h3>A home for your day</h3><p>Recent pages, tasks, reminders and a scratch pad, all on one dashboard you can customize.</p></div>
<div class="tile reveal"><div class="ico">📅</div><h3>Daily notes</h3><p>One keystroke opens today's page with your top three, notes and wins.</p></div>
<div class="tile reveal"><div class="ico">🌐</div><h3>Publish to the web</h3><p>Share any page as a clean public link. Turn it off with one switch.</p></div>
<div class="tile reveal"><div class="ico">🕓</div><h3>Version history</h3><p>Every page keeps its history. Restore any earlier version in a click.</p></div>
<div class="tile reveal"><div class="ico">🛡️</div><h3>Built for teams</h3><p>Roles and guests, two-factor sign-in, comments, an audit log and an admin console.</p></div>
</div>
</div></section>

<section id="apps" style="padding-top:0"><div class="wrap"><div class="apps reveal">
<div><span class="eyebrow" style="color:var(--mint)">Download</span><h2 style="margin-top:12px">Take ${app} with you.</h2>
<p class="lead" style="margin-top:16px">Sign in with the same account everywhere. Your notes stay on the device, so they open instantly and work without a connection.</p></div>
<div class="dl" id="dl"><div class="soon"><span class="i">⏳</span><div><b>Loading downloads…</b></div></div></div>
</div></div></section>

<section id="pricing" style="padding-top:0"><div class="wrap center">
<span class="eyebrow">Pricing</span><h2 style="margin-top:12px">Plans for you, and for your team.</h2>
<p class="lead">Every plan includes the graph, offline apps and unlimited notes. Start free and upgrade any time.</p>
<div style="text-align:left">${plansHtml()}</div>
</div></section>

<section id="faq" style="padding-top:0"><div class="wrap center">
<span class="eyebrow">FAQ</span><h2 style="margin-top:12px">Questions, answered.</h2>
<div class="faq" style="text-align:left">${FAQ.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</div>
</div></section>

<div class="final"><div class="wrap">
<h2>Your second brain, finally connected.</h2>
<p class="lead">Set up your workspace in under a minute. Free for up to three people.</p>
<div class="cta"><a class="btn mint" href="/app/#/signup">Create your workspace</a><a class="btn ghost light" href="/app/#/login">Sign in</a></div>
</div><div class="mk">${MARK_ON_NAVY}</div></div>

<footer><div class="wrap">
<a class="logo" href="/">${MARK_ON_NAVY}<span>${wordmark.replace('<b>', '<b style="color:#8C9DFF">')}</span></a>
<span style="flex:1"></span>
<a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#apps">Apps</a>
${setting('privacy_url') ? `<a href="${e(setting('privacy_url'))}">Privacy</a>` : ''}${setting('terms_url') ? `<a href="${e(setting('terms_url'))}">Terms</a>` : ''}
<span>© ${new Date().getFullYear()} ${app}</span>
</div></footer>

<script>
// Header border on scroll, and gentle reveals.
const hd = document.querySelector('header');
addEventListener('scroll', () => hd.classList.toggle('scrolled', scrollY > 8), { passive: true });
const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -60px' });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

// Pricing: Personal / Teams switch (remembers the choice from a ?plans=team link too).
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('.plans[data-aud]').forEach((p) => { p.hidden = p.dataset.aud !== b.dataset.aud; });
}));
if (new URLSearchParams(location.search).get('plans') === 'team') document.querySelector('.seg [data-aud=team]').click();

// Downloads, from whatever builds the server has.
(async () => {
  const box = document.getElementById('dl');
  const ua = navigator.userAgent;
  const mine = /Android/i.test(ua) ? 'android' : /Windows/i.test(ua) ? 'windows' : /Macintosh/i.test(ua) ? 'mac' : '';
  const icons = { windows: '🪟', android: '🤖', mac: '🍎' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  try {
    const apps = await (await fetch('/api/downloads')).json();
    apps.sort((a, b) => (b.id === mine) - (a.id === mine) || b.available - a.available);
    box.innerHTML = apps.map((a) => {
      const meta = a.available ? [a.version && 'Version ' + a.version, Math.round(a.size / 1e6) + ' MB', a.note].filter(Boolean).join(' · ') : 'Coming soon';
      const inner = '<span class="i">' + (icons[a.id] || '💻') + '</span><div><b>${app} for ' + esc(a.name) + '</b><small>' + esc(meta) + '</small></div>';
      return a.available ? '<a class="' + (a.id === mine ? 'mine' : '') + '" href="' + esc(a.url) + '" download>' + inner + '<span class="go">Download ↓</span></a>'
        : '<div class="soon">' + inner + '</div>';
    }).join('') + '<a href="/app/#/signup"><span class="i">🌐</span><div><b>${app} on the web</b><small>Nothing to install. Works in any modern browser.</small></div><span class="go">Open →</span></a>';
  } catch { box.innerHTML = '<a href="/app/"><span class="i">🌐</span><div><b>Open ${app}</b></div></a>'; }
})();

// The hero graph: a small force-directed layout of a demo workspace.
(() => {
  const data = ${GRAPH};
  const canvas = document.getElementById('graph'), card = document.getElementById('graph-card'), peek = document.getElementById('peek');
  const ctx = canvas.getContext('2d');
  const COLORS = { w: '#647BFF', r: '#83EBC0', p: '#F4D6A0' };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nodes = data.map(([label, group, , text], i) => ({ i, label, group, text, x: 0, y: 0, vx: 0, vy: 0, deg: 0 }));
  const byLabel = Object.fromEntries(nodes.map((n) => [n.label, n]));
  const edges = [], seen = new Set();
  data.forEach(([label, , links]) => links.forEach((t) => {
    const a = byLabel[label], b = byLabel[t]; if (!a || !b) return;
    const k = [a.i, b.i].sort().join('-'); if (seen.has(k)) return; seen.add(k);
    edges.push([a, b]); a.deg++; b.deg++;
  }));
  const nbr = new Map(nodes.map((n) => [n, new Set()]));
  edges.forEach(([a, b]) => { nbr.get(a).add(b); nbr.get(b).add(a); });
  let W = 0, H = 0, dpr = 1, hover = null, drag = null, energy = 1, visible = true;
  const radius = (n) => 4 + Math.sqrt(n.deg) * 3.2;

  function size() {
    const r = canvas.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr;
  }
  size();
  // Start each area in its own region so clusters read clearly.
  const seeds = { w: [0.38, 0.48], r: [0.72, 0.32], p: [0.7, 0.72] };
  nodes.forEach((n) => { const [sx, sy] = seeds[n.group]; n.x = W * sx + (Math.random() - 0.5) * 120; n.y = H * sy + (Math.random() - 0.5) * 120; });

  function step() {
    const cx = W / 2, cy = H / 2 + 10;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy || 0.01;
      const f = 2600 / d2; const d = Math.sqrt(d2); dx /= d; dy /= d;
      a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
    }
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 78) * 0.012;
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    let moved = 0;
    for (const n of nodes) {
      n.vx += (cx - n.x) * 0.0016; n.vy += (cy - n.y) * 0.0022;
      if (n === drag) { n.vx = n.vy = 0; continue; }
      n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
      const r = radius(n) + 8; n.x = Math.max(r, Math.min(W - r, n.x)); n.y = Math.max(r + 34, Math.min(H - r - 30, n.y));
      moved += Math.abs(n.vx) + Math.abs(n.vy);
    }
    energy = moved / nodes.length;
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const focus = hover || drag, near = focus ? nbr.get(focus) : null;
    for (const [a, b] of edges) {
      const on = focus && (a === focus || b === focus);
      ctx.strokeStyle = on ? 'rgba(131,235,192,.9)' : focus ? 'rgba(255,255,255,.05)' : 'rgba(170,182,240,.22)';
      ctx.lineWidth = on ? 1.8 : 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const n of nodes) {
      const dim = focus && n !== focus && !near.has(n);
      const r = radius(n) * (n === focus ? 1.35 : 1);
      if (n === focus || (!focus && n.deg >= 5)) { ctx.fillStyle = COLORS[n.group] + '33'; ctx.beginPath(); ctx.arc(n.x, n.y, r + 7 + (still ? 0 : Math.sin(t / 600 + n.i) * 1.5), 0, 7); ctx.fill(); }
      ctx.globalAlpha = dim ? 0.18 : 1; ctx.fillStyle = COLORS[n.group]; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill();
      if (!dim && (n.deg >= 4 || n === focus || (near && near.has(n)))) {
        ctx.font = (n === focus ? '600 13px' : '500 12px') + ' Inter, system-ui, sans-serif';
        ctx.fillStyle = n === focus ? '#fff' : 'rgba(225,230,255,.85)'; ctx.textAlign = 'center'; const tw = ctx.measureText(n.label).width / 2 + 4; ctx.fillText(n.label, Math.max(tw, Math.min(W - tw, n.x)), n.y + r + 15);
      }
      ctx.globalAlpha = 1;
    }
  }

  function loop(t) {
    if (visible && (energy > 0.02 || drag || hover || !still)) { if (!still || drag) step(); draw(t || 0); }
    requestAnimationFrame(loop);
  }
  if (still) for (let i = 0; i < 400; i++) step();
  for (let i = 0; i < 60; i++) step();
  requestAnimationFrame(loop);

  const at = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const pick = (x, y) => nodes.find((n) => Math.hypot(n.x - x, n.y - y) < radius(n) + 6) || null;
  function showPeek(n) {
    if (!n) { peek.classList.remove('on'); return; }
    const links = nbr.get(n).size;
    peek.innerHTML = '<b></b><span></span><small></small>';
    peek.querySelector('b').textContent = n.label; peek.querySelector('span').textContent = n.text;
    peek.querySelector('small').textContent = links + ' linked note' + (links === 1 ? '' : 's');
    const left = n.x + 18 + 250 > W ? n.x - 268 : n.x + 18, top = Math.max(40, Math.min(H - 150, n.y - 40));
    peek.style.left = left + 'px'; peek.style.top = top + 'px'; peek.classList.add('on');
  }
  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = at(ev);
    if (drag) { drag.x = x; drag.y = y; energy = 1; return; }
    const n = pick(x, y); if (n !== hover) { hover = n; showPeek(n); canvas.style.cursor = n ? 'pointer' : 'grab'; }
  });
  canvas.addEventListener('pointerdown', (ev) => { const [x, y] = at(ev); drag = pick(x, y); if (drag) { canvas.setPointerCapture(ev.pointerId); canvas.classList.add('drag'); peek.classList.remove('on'); } });
  const end = () => { if (drag) { drag = null; canvas.classList.remove('drag'); energy = 1; } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; showPeek(null); } });
  new ResizeObserver(() => { const oW = W, oH = H; size(); nodes.forEach((n) => { n.x *= W / (oW || W); n.y *= H / (oH || H); }); energy = 1; draw(0); }).observe(card);
  new IntersectionObserver(([x]) => { visible = x.isIntersecting; }).observe(card);
})();
</script></body></html>`);
}
