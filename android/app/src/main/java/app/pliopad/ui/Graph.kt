package app.pliopad.ui

import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import app.pliopad.PliopadApp
import app.pliopad.core.Blocks
import app.pliopad.data.NoteEntity
import app.pliopad.data.SessionData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * PlioSphere: every note is a star in a 3D sphere, every [[link]] (and sub-page) a thread between them.
 * Notes in the same notebook share a color. Used by the PlioSphere screen and the home-screen widget.
 */
object GraphModel {
    const val NAME = "PlioSphere"
    val Navy = Color(0xFF101D59)
    val DeepNavy = Color(0xFF0A1240)
    val Periwinkle = Color(0xFF647BFF)
    val Mint = Color(0xFF83EBC0)
    val Ivory = Color(0xFFFAF9F5)
    private val palette = listOf(Periwinkle, Mint, Color(0xFFF4D6A0), Color(0xFFF59EB5), Color(0xFF9AD0F5), Color(0xFFC3B1FF))

    /** A note placed on the unit sphere's interior (x, y, z roughly in -1..1). */
    class Node(val id: String, val title: String, val icon: String?, val color: Color) {
        var x = 0f; var y = 0f; var z = 0f
        var deg = 0
        internal var vx = 0f; internal var vy = 0f; internal var vz = 0f
    }

    /** A link PlioPad discovered by itself (drawn dashed), with the reason. */
    class Discovered(val a: Int, val b: Int, val why: String)

    class Graph(val nodes: List<Node>, val edges: List<Pair<Int, Int>>, val auto: List<Discovered> = emptyList()) {
        val neighbors: List<Set<Int>> = nodes.indices.map { i -> edges.mapNotNull { (a, b) -> if (a == i) b else if (b == i) a else null }.toSet() }
        /** Per note: the notes PlioPad connected it to, and why. */
        val discovered: List<List<Pair<Int, String>>> = nodes.indices.map { i -> auto.mapNotNull { d -> if (d.a == i) d.b to d.why else if (d.b == i) d.a to d.why else null } }
        /** Base dot radius in dp, larger for well-linked notes. */
        fun radius(n: Node) = 4f + sqrt(n.deg.toFloat()) * 2.4f
    }

    /** A node projected to the screen at the current rotation: position, scale (perspective) and depth (0 back … 1 front). */
    class Projected(val i: Int, val x: Float, val y: Float, val scale: Float, val depth: Float)

    /** Builds and lays out the sphere. Connected notes come first; the largest graphs are capped for speed. */
    fun build(notes: List<NoteEntity>, maxNodes: Int = 160, tagNames: Map<String, String> = emptyMap()): Graph {
        val byId = notes.associateBy { it.id }
        val links = mutableSetOf<Pair<String, String>>()
        for (n in notes) {
            Blocks.links(Blocks.parse(n.content)).filter { it in byId && it != n.id }.forEach { links += if (n.id < it) n.id to it else it to n.id }
            n.parentId?.takeIf { it in byId }?.let { links += if (n.id < it) n.id to it else it to n.id }
        }
        val degree = mutableMapOf<String, Int>()
        links.forEach { (a, b) -> degree[a] = (degree[a] ?: 0) + 1; degree[b] = (degree[b] ?: 0) + 1 }
        val chosen = notes.sortedWith(compareByDescending<NoteEntity> { degree[it.id] ?: 0 }.thenByDescending { it.updatedAt }).take(maxNodes)
        val colorOf = chosen.mapNotNull { it.notebookId }.distinct().withIndex().associate { (i, nb) -> nb to palette[i % palette.size] }
        val nodes = chosen.map { Node(it.id, it.title.ifBlank { "Untitled" }, it.icon, it.notebookId?.let { nb -> colorOf[nb] } ?: Ivory) }
        val index = nodes.withIndex().associate { (i, n) -> n.id to i }
        val edges = links.mapNotNull { (a, b) -> val i = index[a]; val j = index[b]; if (i != null && j != null) i to j else null }
        edges.forEach { (a, b) -> nodes[a].deg++; nodes[b].deg++ }
        // Links PlioPad finds by itself: mentions of other notes, shared tags, similar wording.
        val docs = chosen.map { app.pliopad.core.Related.Doc(it.id, it.title, it.plain, runCatching { Blocks.json.decodeFromString(ListSerializer(String.serializer()), it.tags) }.getOrDefault(emptyList())) }
        val linkedIds = links.map { (a, b) -> "$a|$b" }.toSet()
        val auto = app.pliopad.core.Related.find(docs, linkedIds, tagNames).mapNotNull { l -> val i = index[l.a]; val j = index[l.b]; if (i != null && j != null) Discovered(i, j, l.why) else null }
        // Discovered links also pull related notes together.
        layout(nodes, edges + auto.map { it.a to it.b })
        return Graph(nodes, edges, auto)
    }

    /** A deterministic 3D force layout: linked notes pull together, everything repels, then it's fitted into the unit sphere. */
    private fun layout(nodes: List<Node>, edges: List<Pair<Int, Int>>) {
        if (nodes.isEmpty()) return
        val rnd = java.util.Random(nodes.fold(7L) { h, n -> h * 31 + n.id.hashCode() })
        // Start evenly spread over a sphere (Fibonacci spiral) so the result is balanced in every direction.
        val golden = Math.PI * (3 - sqrt(5.0))
        nodes.forEachIndexed { i, n ->
            val y = 1 - (i + 0.5) / nodes.size * 2
            val r = sqrt(1 - y * y)
            val t = golden * i + rnd.nextDouble() * 0.3
            n.x = (cos(t) * r).toFloat() * 300f; n.y = y.toFloat() * 300f; n.z = (sin(t) * r).toFloat() * 300f
        }
        val iterations = if (nodes.size > 100) 220 else 320
        repeat(iterations) { step ->
            val cool = 1f - step / iterations.toFloat() * 0.85f
            for (i in nodes.indices) for (j in i + 1 until nodes.size) {
                val a = nodes[i]; val b = nodes[j]
                var dx = a.x - b.x; var dy = a.y - b.y; var dz = a.z - b.z
                val d2 = max(dx * dx + dy * dy + dz * dz, 1f); val d = sqrt(d2)
                val f = 9000f / d2; dx /= d; dy /= d; dz /= d
                a.vx += dx * f; a.vy += dy * f; a.vz += dz * f; b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f
            }
            for ((ia, ib) in edges) {
                val a = nodes[ia]; val b = nodes[ib]
                val dx = b.x - a.x; val dy = b.y - a.y; val dz = b.z - a.z
                val d = max(sqrt(dx * dx + dy * dy + dz * dz), 1f); val f = (d - 90f) * 0.03f
                a.vx += dx / d * f; a.vy += dy / d * f; a.vz += dz / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; b.vz -= dz / d * f
            }
            for (n in nodes) {
                // Gentle pull to the centre keeps unlinked notes in the sphere instead of drifting off.
                n.vx -= n.x * 0.004f; n.vy -= n.y * 0.004f; n.vz -= n.z * 0.004f
                n.vx *= 0.75f; n.vy *= 0.75f; n.vz *= 0.75f
                n.x += n.vx * cool; n.y += n.vy * cool; n.z += n.vz * cool
            }
        }
        val cx = nodes.map { it.x }.average().toFloat(); val cy = nodes.map { it.y }.average().toFloat(); val cz = nodes.map { it.z }.average().toFloat()
        val far = nodes.maxOf { sqrt((it.x - cx) * (it.x - cx) + (it.y - cy) * (it.y - cy) + (it.z - cz) * (it.z - cz)) }.coerceAtLeast(1f)
        nodes.forEach { it.x = (it.x - cx) / far; it.y = (it.y - cy) / far; it.z = (it.z - cz) / far }
    }

    /**
     * Rotates (yaw around the vertical axis, then pitch) and projects with perspective into a w×h area.
     * Returns nodes sorted back to front, ready to draw.
     */
    fun project(g: Graph, w: Float, h: Float, yaw: Float, pitch: Float, zoom: Float): List<Projected> {
        val cy = cos(yaw); val sy = sin(yaw); val cp = cos(pitch); val sp = sin(pitch)
        val radius = min(w, h) * 0.40f * zoom
        val camera = 3.2f
        return g.nodes.mapIndexed { i, n ->
            val x1 = n.x * cy + n.z * sy
            val z1 = -n.x * sy + n.z * cy
            val y2 = n.y * cp - z1 * sp
            val z2 = n.y * sp + z1 * cp
            val s = camera / (camera - z2)
            Projected(i, w / 2 + x1 * radius * s, h / 2 + y2 * radius * s, s, ((z2 + 1f) / 2f).coerceIn(0f, 1f))
        }.sortedBy { it.depth }
    }

    /** A faint, fixed starfield behind the sphere. */
    val stars: List<Triple<Float, Float, Float>> = java.util.Random(42).let { r -> List(90) { Triple(r.nextFloat(), r.nextFloat(), 0.15f + r.nextFloat() * 0.35f) } }

    /** Draws the sphere into a bitmap for the home-screen widget: a fixed three-quarter view, with names. */
    fun render(g: Graph, width: Int, height: Int, density: Float): Bitmap {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(bmp)
        c.drawColor(DeepNavy.toArgb())
        val star = Paint(Paint.ANTI_ALIAS_FLAG)
        stars.forEach { (sx, sy, a) -> star.color = Color.White.copy(alpha = a * 0.6f).toArgb(); c.drawCircle(sx * width, sy * height, density * 0.6f, star) }
        if (g.nodes.isEmpty()) return bmp
        val pts = project(g, width.toFloat(), height.toFloat(), yaw = 0.6f, pitch = -0.35f, zoom = 1.05f)
        val at = pts.associateBy { it.i }
        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 1f * density }
        g.edges.forEach { (a, b) ->
            val pa = at[a]!!; val pb = at[b]!!
            line.color = Color(0xFFAAB6F0).copy(alpha = 0.12f + 0.35f * (pa.depth + pb.depth) / 2).toArgb()
            c.drawLine(pa.x, pa.y, pb.x, pb.y, line)
        }
        val dash = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 1f * density; pathEffect = android.graphics.DashPathEffect(floatArrayOf(4f * density, 4f * density), 0f) }
        g.auto.forEach { d ->
            val pa = at[d.a]!!; val pb = at[d.b]!!
            dash.color = Mint.copy(alpha = 0.15f + 0.35f * (pa.depth + pb.depth) / 2).toArgb()
            c.drawLine(pa.x, pa.y, pb.x, pb.y, dash)
        }
        val dot = Paint(Paint.ANTI_ALIAS_FLAG)
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); textAlign = Paint.Align.CENTER }
        // In a small widget only the closest, best-linked notes are named, so the names stay readable.
        val named = pts.sortedByDescending { it.depth * 2 + g.nodes[it.i].deg * 0.3f }.take(if (min(width, height) > 300 * density) 9 else 5).map { it.i }.toSet()
        pts.forEach { p ->
            val n = g.nodes[p.i]
            val r = g.radius(n) * density * 0.75f * p.scale
            dot.color = n.color.copy(alpha = 0.35f + 0.65f * p.depth).toArgb()
            c.drawCircle(p.x, p.y, r, dot)
            if (p.i in named) {
                label.textSize = (9f + 2f * p.depth) * density
                label.color = Color.White.copy(alpha = 0.45f + 0.5f * p.depth).toArgb()
                val t = if (n.title.length > 18) n.title.take(17) + "…" else n.title
                val half = label.measureText(t) / 2 + 2 * density
                c.drawText(t, p.x.coerceIn(half, width - half), p.y + r + 11f * density, label)
            }
        }
        return bmp
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GraphScreen(app: PliopadApp, s: SessionData, nav: NavHostController, onOpen: (String) -> Unit) {
    val ws = s.workspace?.id ?: 0
    var graph by remember { mutableStateOf<GraphModel.Graph?>(null) }
    LaunchedEffect(ws) { graph = withContext(Dispatchers.Default) { GraphModel.build(app.dao.allNotesList(ws), maxNodes = 300, tagNames = app.dao.tags(ws).first().associate { it.id to it.name }) } }
    var yaw by remember { mutableFloatStateOf(0.5f) }
    var pitch by remember { mutableFloatStateOf(-0.3f) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var showAuto by remember { mutableStateOf(true) }
    var selected by remember { mutableStateOf<Int?>(null) }
    var lastTouch by remember { mutableLongStateOf(0L) }
    // Where each note was last drawn, for tapping (a plain holder: it changes every frame and nothing recomposes from it).
    val projected = remember { arrayOf<List<GraphModel.Projected>>(emptyList()) }
    val g = graph

    // A slow drift, paused while you're touching it (and for a few seconds after) or looking at a note.
    LaunchedEffect(g) {
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                if (last != 0L && selected == null && System.currentTimeMillis() - lastTouch > 2500) yaw += (now - last) / 1e9f * 0.12f
                last = now
            }
        }
    }

    Scaffold(
        containerColor = GraphModel.DeepNavy,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(GraphModel.NAME, color = Color.White, fontWeight = FontWeight.Bold)
                        if (g != null) Text("${g.nodes.size} notes · ${g.edges.size} links · ${g.auto.size} discovered", color = GraphModel.Mint, fontSize = 12.sp)
                    }
                },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White) } },
                actions = {
                    // Discovered links on/off.
                    IconButton(onClick = { showAuto = !showAuto }) { Icon(Icons.Default.AutoAwesome, if (showAuto) "Hide discovered links" else "Show discovered links", tint = if (showAuto) GraphModel.Mint else Color.White.copy(alpha = 0.5f)) }
                    IconButton(onClick = { zoom = 1f; yaw = 0.5f; pitch = -0.3f; selected = null }) { Icon(Icons.Default.CenterFocusStrong, "Recenter", tint = Color.White) }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Transparent),
            )
        },
    ) { pad ->
        Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(GraphModel.Navy, GraphModel.DeepNavy))).padding(pad)) {
            if (g == null) { Text("Mapping your notes…", color = Color(0xFFAEB6E0), modifier = Modifier.align(Alignment.Center)); return@Box }
            if (g.nodes.isEmpty()) { Text("Link notes with [[ to see them connect here.", color = Color(0xFFAEB6E0), modifier = Modifier.align(Alignment.Center).padding(32.dp)); return@Box }
            Canvas(
                Modifier.fillMaxSize()
                    .pointerInput(g) {
                        // Drag to spin the sphere, pinch to zoom.
                        detectTransformGestures { _, pan, z, _ ->
                            lastTouch = System.currentTimeMillis()
                            yaw += pan.x * 0.006f
                            pitch = (pitch - pan.y * 0.006f).coerceIn(-1.4f, 1.4f)
                            zoom = (zoom * z).coerceIn(0.6f, 4f)
                        }
                    }
                    .pointerInput(g) {
                        detectTapGestures { at ->
                            lastTouch = System.currentTimeMillis()
                            // The closest dot to the finger, preferring ones in front.
                            val hit = projected[0].filter { hypot(it.x - at.x, it.y - at.y) < 30.dp.toPx() }.maxByOrNull { it.depth }?.i
                            selected = if (hit != null && hit == selected) { onOpen(g.nodes[hit].id); null } else hit
                        }
                    },
            ) {
                GraphModel.stars.forEach { (sx, sy, a) -> drawCircle(Color.White.copy(alpha = a), 1.2.dp.toPx(), Offset(sx * size.width, sy * size.height)) }
                val pts = GraphModel.project(g, size.width, size.height, yaw, pitch, zoom)
                projected[0] = pts
                val at = pts.associateBy { it.i }
                val near = selected?.let { g.neighbors[it] + (if (showAuto) g.discovered[it].map { d -> d.first } else emptyList()) }
                if (showAuto) g.auto.forEach { d ->
                    val pa = at[d.a]!!; val pb = at[d.b]!!
                    val on = selected != null && (d.a == selected || d.b == selected)
                    val depth = (pa.depth + pb.depth) / 2
                    drawLine(if (on) GraphModel.Mint else if (selected != null) Color.White.copy(alpha = 0.04f) else GraphModel.Mint.copy(alpha = 0.14f + 0.36f * depth),
                        Offset(pa.x, pa.y), Offset(pb.x, pb.y), strokeWidth = (if (on) 1.6f else 1f).dp.toPx() * (0.6f + 0.6f * depth),
                        pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 5.dp.toPx())))
                }
                // Threads first, fading with depth; the selected note's threads light up in mint.
                g.edges.forEach { (a, b) ->
                    val pa = at[a]!!; val pb = at[b]!!
                    val on = selected != null && (a == selected || b == selected)
                    val depth = (pa.depth + pb.depth) / 2
                    val color = when {
                        on -> GraphModel.Mint
                        selected != null -> Color.White.copy(alpha = 0.04f)
                        else -> Color(0xFFAAB6F0).copy(alpha = 0.08f + 0.32f * depth)
                    }
                    drawLine(color, Offset(pa.x, pa.y), Offset(pb.x, pb.y), strokeWidth = (if (on) 2f else 1f).dp.toPx() * (0.6f + 0.6f * depth))
                }
                val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD }
                val canvas = drawContext.canvas.nativeCanvas
                // Back to front, so nearer stars and names sit on top. Every note keeps its name.
                pts.forEach { p ->
                    val n = g.nodes[p.i]
                    val dim = selected != null && p.i != selected && near?.contains(p.i) != true
                    val fade = if (dim) 0.18f else 0.35f + 0.65f * p.depth
                    val r = g.radius(n).dp.toPx() * p.scale * (if (p.i == selected) 1.5f else 1f) * sqrt(zoom).coerceAtMost(1.8f)
                    if (p.i == selected || (!dim && p.depth > 0.7f && n.deg >= 3)) drawCircle(n.color.copy(alpha = 0.22f * fade), r * 2.6f, Offset(p.x, p.y))
                    drawCircle(n.color.copy(alpha = fade), r, Offset(p.x, p.y))
                    label.textSize = (9f + 4f * p.depth).sp.toPx() * (if (p.i == selected) 1.2f else 1f)
                    label.color = Color.White.copy(alpha = if (dim) 0.12f else 0.3f + 0.7f * p.depth).toArgb()
                    val t = if (n.title.length > 26) n.title.take(25) + "…" else n.title
                    canvas.drawText(t, p.x, p.y + r + label.textSize + 2.dp.toPx(), label)
                }
            }
            selected?.let { i ->
                val n = g.nodes[i]
                Row(
                    Modifier.align(Alignment.BottomCenter).padding(16.dp).fillMaxWidth().background(GraphModel.Ivory, RoundedCornerShape(18.dp))
                        .clickable { onOpen(n.id) }.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(12.dp).background(n.color, CircleShape))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("${n.icon?.plus(" ") ?: ""}${n.title}", fontWeight = FontWeight.SemiBold, color = GraphModel.Navy, maxLines = 1)
                        val found = if (showAuto) g.discovered[i] else emptyList()
                        Text("${g.neighbors[i].size} linked note${if (g.neighbors[i].size == 1) "" else "s"}" + (if (found.isNotEmpty()) " · ${found.size} discovered" else ""), color = Color(0xFF5D6485), fontSize = 13.sp)
                        found.take(2).forEach { (j, why) -> Text("✦ ${g.nodes[j].title} · $why", color = GraphModel.Navy, fontSize = 12.sp, maxLines = 1) }
                    }
                    TextButton(onClick = { onOpen(n.id) }) { Text("Open", color = GraphModel.Periwinkle, fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}
