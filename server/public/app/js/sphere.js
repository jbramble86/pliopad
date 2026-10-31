// PlioSphere: notes as stars in a slowly turning 3D sphere, links as threads between them.
// Shared by the web app (PlioSphere page) and the marketing site, so both look and behave the same.
// Plain canvas 2D with a small perspective projection; no libraries.

const PALETTE = ['#647BFF', '#83EBC0', '#F4D6A0', '#F59EB5', '#9AD0F5', '#C3B1FF'];
const NAVY = '#101D59', DEEP = '#0A1240', MINT = '#83EBC0', IVORY = '#FAF9F5';

/** Deterministic 3D force layout, fitted into the unit sphere. Mutates nodes (x, y, z) and returns them. */
function layout(nodes, edges) {
  if (!nodes.length) return nodes;
  let seed = nodes.reduce((h, n) => (h * 31 + [...n.id].reduce((a, c) => a + c.charCodeAt(0), 0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const golden = Math.PI * (3 - Math.sqrt(5));
  nodes.forEach((n, i) => {
    const y = 1 - ((i + 0.5) / nodes.length) * 2, r = Math.sqrt(1 - y * y), t = golden * i + rnd() * 0.3;
    Object.assign(n, { x: Math.cos(t) * r * 300, y: y * 300, z: Math.sin(t) * r * 300, vx: 0, vy: 0, vz: 0 });
  });
  const iters = nodes.length > 120 ? 200 : 300;
  for (let step = 0; step < iters; step++) {
    const cool = 1 - (step / iters) * 0.85;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const d2 = Math.max(dx * dx + dy * dy + dz * dz, 1), d = Math.sqrt(d2), f = 9000 / d2;
      dx /= d; dy /= d; dz /= d;
      a.vx += dx * f; a.vy += dy * f; a.vz += dz * f; b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
    }
    for (const [ia, ib] of edges) {
      const a = nodes[ia], b = nodes[ib], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1), f = (d - 90) * 0.03;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; a.vz += (dz / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; b.vz -= (dz / d) * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004; n.vy -= n.y * 0.004; n.vz -= n.z * 0.004;
      n.vx *= 0.75; n.vy *= 0.75; n.vz *= 0.75;
      n.x += n.vx * cool; n.y += n.vy * cool; n.z += n.vz * cool;
    }
  }
  const c = ['x', 'y', 'z'].map((k) => nodes.reduce((s, n) => s + n[k], 0) / nodes.length);
  const far = Math.max(1, ...nodes.map((n) => Math.hypot(n.x - c[0], n.y - c[1], n.z - c[2])));
  for (const n of nodes) { n.x = (n.x - c[0]) / far; n.y = (n.y - c[1]) / far; n.z = (n.z - c[2]) / far; }
  return nodes;
}

/**
 * Mounts a PlioSphere in a canvas.
 * data: { nodes: [{ id, title, icon?, group? }], edges: [[fromId, toId]], auto?: [{ a, b, why }] }
 * (auto = links PlioPad discovered by itself; drawn dashed and hidden with setShowAuto(false))
 * opts: { onOpen(node), onHover(node|null, x, y), onSelect(node|null), autoRotate = true, labels = 'all' | number, zoom = 1 }
 */
export function createSphere(canvas, data, opts = {}) {
  const ctx = canvas.getContext('2d');
  const groups = [...new Set(data.nodes.map((n) => n.group).filter(Boolean))];
  const nodes = data.nodes.map((n) => ({ ...n, deg: 0, color: n.color || (n.group ? PALETTE[groups.indexOf(n.group) % PALETTE.length] : IVORY) }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const seen = new Set();
  const edges = [];
  for (const [a, b] of data.edges) {
    const i = index.get(a), j = index.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    const k = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seen.has(k)) continue;
    seen.add(k); edges.push([i, j]); nodes[i].deg++; nodes[j].deg++;
  }
  // Discovered links: dashed threads, with the reason PlioPad found them.
  const autoEdges = [];
  for (const { a, b, why } of data.auto || []) {
    const i = index.get(a), j = index.get(b);
    if (i === undefined || j === undefined || i === j || seen.has(i < j ? `${i}-${j}` : `${j}-${i}`)) continue;
    autoEdges.push([i, j, why]);
  }
  // Discovered links also pull related notes together in the layout.
  layout(nodes, [...edges, ...autoEdges.map(([i, j]) => [i, j])]);
  const neighbors = nodes.map(() => new Set());
  for (const [a, b] of edges) { neighbors[a].add(b); neighbors[b].add(a); }
  const discovered = nodes.map(() => []);
  for (const [a, b, why] of autoEdges) { discovered[a].push({ j: b, why }); discovered[b].push({ j: a, why }); }
  let showAuto = opts.showAuto !== false;

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stars = Array.from({ length: 110 }, (_, i) => [((i * 7919) % 1000) / 1000, ((i * 104729) % 997) / 997, 0.12 + ((i * 31) % 40) / 100]);
  const startZoom = opts.zoom || 1;
  let W = 0, H = 0, dpr = 1, yaw = 0.5, pitch = -0.3, zoom = startZoom;
  let hover = null, selected = null, lastTouch = 0, projected = [], visible = true, raf = 0, last = 0;
  const pointers = new Map();
  let drag = null, pinch = null;

  const size = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  };
  const radiusOf = (n) => 3.5 + Math.sqrt(n.deg) * 2.4;

  function project() {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const R = Math.min(W, H) * 0.40 * zoom, cam = 3.2;
    projected = nodes.map((n, i) => {
      const x1 = n.x * cy + n.z * sy, z1 = -n.x * sy + n.z * cy;
      const y2 = n.y * cp - z1 * sp, z2 = n.y * sp + z1 * cp;
      const s = cam / (cam - z2);
      return { i, x: W / 2 + x1 * R * s, y: H / 2 + y2 * R * s, s, depth: Math.min(1, Math.max(0, (z2 + 1) / 2)) };
    }).sort((a, b) => a.depth - b.depth);
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, NAVY); g.addColorStop(1, DEEP);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const [sx, sy, a] of stars) { ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx * W, sy * H, 1, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    project();
    const at = new Array(nodes.length);
    for (const p of projected) at[p.i] = p;
    const focus = selected ?? hover;
    const near = focus != null ? new Set([...neighbors[focus], ...(showAuto ? discovered[focus].map((d) => d.j) : [])]) : null;
    if (showAuto) {
      ctx.setLineDash([4, 5]);
      for (const [a, b] of autoEdges) {
        const pa = at[a], pb = at[b], on = focus != null && (a === focus || b === focus);
        const depth = (pa.depth + pb.depth) / 2;
        ctx.strokeStyle = on ? 'rgba(131,235,192,0.95)' : focus != null ? 'rgba(255,255,255,0.04)' : `rgba(131,235,192,${0.14 + 0.36 * depth})`;
        ctx.lineWidth = (on ? 1.6 : 1) * (0.6 + 0.6 * depth);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    for (const [a, b] of edges) {
      const pa = at[a], pb = at[b], on = focus != null && (a === focus || b === focus);
      const depth = (pa.depth + pb.depth) / 2;
      ctx.strokeStyle = on ? MINT : focus != null ? 'rgba(255,255,255,0.05)' : `rgba(170,182,240,${0.08 + 0.32 * depth})`;
      ctx.lineWidth = (on ? 2 : 1) * (0.6 + 0.6 * depth);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    const labelLimit = opts.labels === 'all' || opts.labels == null ? Infinity : opts.labels;
    const named = labelLimit === Infinity ? null
      : new Set([...projected].sort((p, q) => (q.depth * 2 + nodes[q.i].deg * 0.3) - (p.depth * 2 + nodes[p.i].deg * 0.3)).slice(0, labelLimit).map((p) => p.i));
    ctx.textAlign = 'center';
    for (const p of projected) {
      const n = nodes[p.i];
      const dim = focus != null && p.i !== focus && !near.has(p.i);
      const fade = dim ? 0.18 : 0.35 + 0.65 * p.depth;
      const r = radiusOf(n) * p.s * (p.i === focus ? 1.5 : 1) * Math.min(1.8, Math.sqrt(zoom));
      if (p.i === focus || (!dim && p.depth > 0.7 && n.deg >= 3)) {
        ctx.globalAlpha = 0.22 * fade; ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = fade; ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
      if (p.i === focus || near?.has(p.i) || !named || named.has(p.i)) {
        const fs = (9 + 4 * p.depth) * (p.i === focus ? 1.2 : 1);
        ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
        ctx.globalAlpha = dim ? 0.12 : 0.3 + 0.7 * p.depth;
        ctx.fillStyle = '#fff';
        const t = n.title.length > 26 ? n.title.slice(0, 25) + '…' : n.title;
        ctx.fillText(t, p.x, p.y + r + fs + 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = 0;
    if (!canvas.isConnected) return destroy();
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (opts.autoRotate !== false && !still && selected == null && hover == null && !drag && Date.now() - lastTouch > 2500) yaw += dt * 0.12;
    draw();
    if (visible) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } };

  const pick = (x, y) => {
    let best = null;
    for (const p of projected) if (Math.hypot(p.x - x, p.y - y) < Math.max(12, radiusOf(nodes[p.i]) * p.s + 6) && (!best || p.depth > best.depth)) best = p;
    return best ? best.i : null;
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    lastTouch = Date.now();
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom }; drag = null; }
    else { const [x, y] = local(e); drag = { x, y, yaw, pitch, moved: false }; }
    kick();
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [x, y]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoom = Math.min(4, Math.max(0.6, pinch.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
      lastTouch = Date.now();
      return kick();
    }
    if (drag) {
      const dx = x - drag.x, dy = y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      yaw = drag.yaw + dx * 0.006;
      pitch = Math.max(-1.4, Math.min(1.4, drag.pitch - dy * 0.006));
      lastTouch = Date.now();
      canvas.style.cursor = 'grabbing';
      return kick();
    }
    const h = pick(x, y);
    if (h !== hover) { hover = h; opts.onHover?.(h == null ? null : nodes[h], x, y); kick(); }
    canvas.style.cursor = h != null ? 'pointer' : 'grab';
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === 'pointerup') {
      const [x, y] = local(e);
      const h = pick(x, y);
      // First tap selects (and lights up its links); tapping the selected note again opens it.
      if (h != null && h === selected) opts.onOpen?.(nodes[h]);
      else { selected = h; opts.onSelect?.(h == null ? null : nodes[h]); }
    }
    drag = null;
    canvas.style.cursor = hover != null ? 'pointer' : 'grab';
    kick();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag && hover != null) { hover = null; opts.onHover?.(null); kick(); } });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.min(4, Math.max(0.6, zoom * (e.deltaY < 0 ? 1.08 : 0.93))); lastTouch = Date.now(); kick(); }, { passive: false });

  const ro = new ResizeObserver(() => { size(); kick(); });
  ro.observe(canvas);
  const io = new IntersectionObserver(([x]) => { visible = x.isIntersecting; kick(); });
  io.observe(canvas);
  size();
  kick();

  function destroy() { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); io.disconnect(); }
  return {
    destroy,
    stats: { notes: nodes.length, links: edges.length, discovered: autoEdges.length },
    setShowAuto(v) { showAuto = !!v; kick(); },
    /** The links PlioPad discovered for a note: [{ title, why }]. */
    discovered: (node) => (discovered[index.get(node.id)] || []).map((d) => ({ title: nodes[d.j].title, why: d.why })),
    recenter() { yaw = 0.5; pitch = -0.3; zoom = startZoom; selected = null; opts.onSelect?.(null); kick(); },
    neighbors: (node) => neighbors[index.get(node.id)]?.size || 0,
  };
}
