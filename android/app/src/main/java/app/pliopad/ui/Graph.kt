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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.withTransform
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
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * The knowledge graph: every note is a dot, every [[link]] (and sub-page) a line. Notes in the same notebook
 * share a color. Used by the Graph screen and by the home-screen widget, so both look the same.
 */
object GraphModel {
    val Navy = Color(0xFF101D59)
    val Periwinkle = Color(0xFF647BFF)
    val Mint = Color(0xFF83EBC0)
    val Ivory = Color(0xFFFAF9F5)
    private val palette = listOf(Periwinkle, Mint, Color(0xFFF4D6A0), Color(0xFFF59EB5), Color(0xFF9AD0F5), Color(0xFFC3B1FF))

    class Node(val id: String, val title: String, val icon: String?, val color: Color, var x: Float = 0f, var y: Float = 0f) {
        var deg = 0
        var vx = 0f
        var vy = 0f
    }

    class Graph(val nodes: List<Node>, val edges: List<Pair<Int, Int>>) {
        val neighbors: List<Set<Int>> = nodes.indices.map { i -> edges.mapNotNull { (a, b) -> if (a == i) b else if (b == i) a else null }.toSet() }
        fun radius(n: Node) = 4f + sqrt(n.deg.toFloat()) * 2.6f
    }

    /** Builds and lays out the graph. Connected notes come first; the largest graphs are capped for speed. */
    fun build(notes: List<NoteEntity>, maxNodes: Int = 160): Graph {
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
        val nodes = chosen.map { Node(it.id, it.title.ifBlank { "Untitled" }, it.icon, it.notebookId?.let { nb -> colorOf[nb] } ?: Ivory.copy(alpha = 0.85f)) }
        val index = nodes.withIndex().associate { (i, n) -> n.id to i }
        val edges = links.mapNotNull { (a, b) -> val i = index[a]; val j = index[b]; if (i != null && j != null) i to j else null }
        edges.forEach { (a, b) -> nodes[a].deg++; nodes[b].deg++ }
        layout(nodes, edges)
        return Graph(nodes, edges)
    }

    /** A deterministic force layout in a 1000×1000 box (same picture every time for the same notes). */
    private fun layout(nodes: List<Node>, edges: List<Pair<Int, Int>>) {
        val rnd = java.util.Random(nodes.fold(7L) { h, n -> h * 31 + n.id.hashCode() })
        nodes.forEach { it.x = 500f + (rnd.nextFloat() - 0.5f) * 600f; it.y = 500f + (rnd.nextFloat() - 0.5f) * 600f }
        val iterations = if (nodes.size > 100) 220 else 320
        repeat(iterations) { step ->
            val cool = 1f - step / iterations.toFloat() * 0.85f
            for (i in nodes.indices) for (j in i + 1 until nodes.size) {
                val a = nodes[i]; val b = nodes[j]
                var dx = a.x - b.x; var dy = a.y - b.y
                val d2 = max(dx * dx + dy * dy, 1f); val d = sqrt(d2)
                val f = 2400f / d2; dx /= d; dy /= d
                a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f
            }
            for ((ia, ib) in edges) {
                val a = nodes[ia]; val b = nodes[ib]
                val dx = b.x - a.x; val dy = b.y - a.y; val d = max(hypot(dx, dy), 1f); val f = (d - 70f) * 0.02f
                a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f
            }
            for (n in nodes) {
                n.vx += (500f - n.x) * 0.004f; n.vy += (500f - n.y) * 0.004f
                n.vx *= 0.75f; n.vy *= 0.75f
                n.x += n.vx * cool; n.y += n.vy * cool
            }
        }
        // Fit into the box with a margin.
        if (nodes.isEmpty()) return
        val minX = nodes.minOf { it.x }; val maxX = nodes.maxOf { it.x }; val minY = nodes.minOf { it.y }; val maxY = nodes.maxOf { it.y }
        val s = 860f / max(max(maxX - minX, maxY - minY), 1f)
        val ox = (1000f - (maxX - minX) * s) / 2; val oy = (1000f - (maxY - minY) * s) / 2
        nodes.forEach { it.x = (it.x - minX) * s + ox; it.y = (it.y - minY) * s + oy }
    }

    /** Draws the graph into a bitmap for the home-screen widget (navy background, labels on the hubs). */
    fun render(g: Graph, width: Int, height: Int, density: Float): Bitmap {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(bmp)
        c.drawColor(Navy.toArgb())
        if (g.nodes.isEmpty()) return bmp
        val scale = min(width, height) / 1000f
        val ox = (width - 1000f * scale) / 2; val oy = (height - 1000f * scale) / 2
        fun px(n: Node) = ox + n.x * scale
        fun py(n: Node) = oy + n.y * scale
        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.argb(70, 170, 182, 240); strokeWidth = 1f * density }
        g.edges.forEach { (a, b) -> c.drawLine(px(g.nodes[a]), py(g.nodes[a]), px(g.nodes[b]), py(g.nodes[b]), line) }
        val dot = Paint(Paint.ANTI_ALIAS_FLAG)
        val r = density * 0.9f * (min(width, height) / (220f * density)).coerceIn(0.7f, 1.6f)
        g.nodes.forEach { n -> dot.color = n.color.toArgb(); c.drawCircle(px(n), py(n), g.radius(n) * r, dot) }
        val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.argb(225, 230, 234, 255); textSize = 10f * density; typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); textAlign = Paint.Align.CENTER }
        val hubs = g.nodes.sortedByDescending { it.deg }.take(if (min(width, height) > 300 * density) 6 else 3).filter { it.deg >= 2 }
        hubs.forEach { n ->
            val t = if (n.title.length > 18) n.title.take(17) + "…" else n.title
            val w = label.measureText(t) / 2 + 2 * density
            c.drawText(t, px(n).coerceIn(w, width - w), py(n) + g.radius(n) * r + 12f * density, label)
        }
        return bmp
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GraphScreen(app: PliopadApp, s: SessionData, nav: NavHostController, onOpen: (String) -> Unit) {
    val ws = s.workspace?.id ?: 0
    var graph by remember { mutableStateOf<GraphModel.Graph?>(null) }
    LaunchedEffect(ws) { graph = withContext(Dispatchers.Default) { GraphModel.build(app.dao.allNotesList(ws), maxNodes = 400) } }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var selected by remember { mutableStateOf<Int?>(null) }
    var box by remember { mutableStateOf(androidx.compose.ui.geometry.Size.Zero) }
    val g = graph

    Scaffold(
        containerColor = GraphModel.Navy,
        topBar = {
            TopAppBar(
                title = { Text(if (g == null) "Graph" else "Graph · ${g.nodes.size} notes · ${g.edges.size} links", color = Color.White) },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White) } },
                actions = { IconButton(onClick = { zoom = 1f; pan = Offset.Zero; selected = null }) { Icon(Icons.Default.CenterFocusStrong, "Recenter", tint = Color.White) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = GraphModel.Navy),
            )
        },
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            if (g == null) { Text("Drawing your graph…", color = Color(0xFFAEB6E0), modifier = Modifier.align(Alignment.Center)); return@Box }
            if (g.nodes.isEmpty()) { Text("Link notes with [[ to see them connect here.", color = Color(0xFFAEB6E0), modifier = Modifier.align(Alignment.Center).padding(32.dp)); return@Box }
            // Screen position of a node at the current zoom and pan.
            fun base() = min(box.width, box.height) / 1000f
            fun sx(n: GraphModel.Node) = box.width / 2 + ((n.x - 500f) * base()) * zoom + pan.x
            fun sy(n: GraphModel.Node) = box.height / 2 + ((n.y - 500f) * base()) * zoom + pan.y
            Canvas(
                Modifier.fillMaxSize()
                    .pointerInput(g) { detectTransformGestures { _, p, z, _ -> zoom = (zoom * z).coerceIn(0.5f, 6f); pan += p } }
                    .pointerInput(g) {
                        detectTapGestures { at ->
                            val hit = g.nodes.indices.minByOrNull { i -> hypot(sx(g.nodes[i]) - at.x, sy(g.nodes[i]) - at.y) }
                                ?.takeIf { i -> hypot(sx(g.nodes[i]) - at.x, sy(g.nodes[i]) - at.y) < 28.dp.toPx() }
                            selected = if (hit != null && hit == selected) { onOpen(g.nodes[hit].id); null } else hit
                        }
                    },
            ) {
                box = size
                val near = selected?.let { g.neighbors[it] }
                g.edges.forEach { (a, b) ->
                    val on = selected != null && (a == selected || b == selected)
                    drawLine(if (on) GraphModel.Mint else if (selected != null) Color.White.copy(alpha = 0.05f) else Color(0x40AAB6F0),
                        Offset(sx(g.nodes[a]), sy(g.nodes[a])), Offset(sx(g.nodes[b]), sy(g.nodes[b])), strokeWidth = if (on) 2.dp.toPx() else 1.dp.toPx())
                }
                val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 11.sp.toPx(); textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD }
                g.nodes.forEachIndexed { i, n ->
                    val dim = selected != null && i != selected && near?.contains(i) != true
                    val r = g.radius(n) * 1.15f.dp.toPx() * (if (i == selected) 1.4f else 1f) * sqrt(zoom).coerceAtMost(1.8f)
                    if (i == selected) drawCircle(n.color.copy(alpha = 0.25f), r + 8.dp.toPx(), Offset(sx(n), sy(n)))
                    drawCircle(n.color.copy(alpha = if (dim) 0.2f else 1f), r, Offset(sx(n), sy(n)))
                    if (!dim && (i == selected || near?.contains(i) == true || n.deg >= 4 || zoom > 1.8f)) {
                        label.color = if (i == selected) android.graphics.Color.WHITE else android.graphics.Color.argb(215, 225, 230, 255)
                        drawContext.canvas.nativeCanvas.drawText(n.title.take(28), sx(n), sy(n) + r + 14.dp.toPx(), label)
                    }
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
                        Text("${g.neighbors[i].size} linked note${if (g.neighbors[i].size == 1) "" else "s"}", color = Color(0xFF5D6485), fontSize = 13.sp)
                    }
                    TextButton(onClick = { onOpen(n.id) }) { Text("Open", color = GraphModel.Periwinkle, fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}
