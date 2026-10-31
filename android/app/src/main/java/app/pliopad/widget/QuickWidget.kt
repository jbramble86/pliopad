package app.pliopad.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.CheckBox
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextDecoration
import androidx.glance.text.TextStyle
import app.pliopad.MainActivity
import app.pliopad.ui.GraphModel
import app.pliopad.PliopadApp
import app.pliopad.core.Blocks
import app.pliopad.data.NoteEntity
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import java.time.LocalDate

// ---------- Shared look: PlioPad's colors, following the phone's light/dark mode ----------

private val WidgetColors = ColorProviders(
    light = lightColorScheme(primary = Color(0xFF647BFF), onPrimary = Color.White, primaryContainer = Color(0xFFE3E8FF), onPrimaryContainer = Color(0xFF101D59),
        surface = Color.White, onSurface = Color(0xFF18181B), surfaceVariant = Color(0xFFF4F4F5), onSurfaceVariant = Color(0xFF71717A),
        secondaryContainer = Color(0xFFFEF3C7), errorContainer = Color(0xFFFEE2E2), tertiaryContainer = Color(0xFFFFEDD5)),
    dark = darkColorScheme(primary = Color(0xFF8C9DFF), onPrimary = Color(0xFF101D59), primaryContainer = Color(0xFF293C91), onPrimaryContainer = Color(0xFFE3E8FF),
        surface = Color(0xFF1C1C1F), onSurface = Color(0xFFF4F4F5), surfaceVariant = Color(0xFF27272A), onSurfaceVariant = Color(0xFFA1A1AA),
        secondaryContainer = Color(0xFF3A3215), errorContainer = Color(0xFF4C1D1D), tertiaryContainer = Color(0xFF4A2C12)),
)

@Composable
private fun WidgetFrame(content: @Composable () -> Unit) {
    GlanceTheme(colors = WidgetColors) {
        Box(GlanceModifier.fillMaxSize().background(GlanceTheme.colors.surface).cornerRadius(22.dp).padding(12.dp)) { content() }
    }
}

@Composable
private fun Header(title: String, action: Pair<String, androidx.glance.action.Action>? = null) {
    Row(GlanceModifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp, color = GlanceTheme.colors.onSurface), modifier = GlanceModifier.defaultWeight())
        action?.let { (label, a) ->
            Text(label, style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 13.sp, color = GlanceTheme.colors.primary),
                modifier = GlanceModifier.cornerRadius(12.dp).background(GlanceTheme.colors.primaryContainer).padding(horizontal = 10.dp, vertical = 4.dp).clickable(a))
        }
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = TextStyle(fontSize = 13.sp, color = GlanceTheme.colors.onSurfaceVariant), modifier = GlanceModifier.padding(vertical = 6.dp))

/** Opens the app: a note, or an action ("new", "scan", "voice", "daily", "search"). */
internal fun openIntent(ctx: Context, note: String? = null, action: String? = null) =
    Intent(ctx, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .apply { note?.let { putExtra(MainActivity.EXTRA_NOTE, it) }; action?.let { putExtra(MainActivity.EXTRA_ACTION, it) }; data = android.net.Uri.parse("pliopad://w/${note ?: action}") }

private suspend fun signedInWs(ctx: Context): Long? = (ctx.applicationContext as PliopadApp).session.current().let { if (it.signedIn) it.wsId else null }

// ---------- 1. Quick capture ----------

/** One tap to capture: note, voice, scan, daily note, search. Grows into a 2×3 grid of big buttons when there is room. */
class QuickWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(120.dp, 60.dp), DpSize(250.dp, 60.dp), DpSize(250.dp, 140.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val signedIn = signedInWs(context) != null
        provideContent { QuickContent(signedIn) }
    }
}

@Composable
internal fun QuickContent(signedIn: Boolean) {
            WidgetFrame {
                val ctx = LocalContext.current
                if (!signedIn) { Muted("Sign in to PlioPad"); return@WidgetFrame }
                val size = LocalSize.current
                val buttons = listOf("📝" to "Note" to "new", "🎙️" to "Voice" to "voice", "📷" to "Scan" to "scan", "📅" to "Daily" to "daily", "🔎" to "Search" to "search", "☑️" to "Tasks" to "tasks")
                val shown = when { size.width < 200.dp -> buttons.take(2); size.height < 120.dp -> buttons.take(4); else -> buttons }
                val perRow = if (size.height >= 120.dp) 3 else shown.size
                Column(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                    shown.chunked(perRow).forEach { row ->
                        Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
                            row.forEachIndexed { i, (labelIcon, action) ->
                                val (icon, label) = labelIcon
                                Column(GlanceModifier.defaultWeight().fillMaxHeight().padding(3.dp).cornerRadius(16.dp)
                                    .background(if (action == "new") GlanceTheme.colors.primary else GlanceTheme.colors.surfaceVariant)
                                    .clickable(actionStartActivity(openIntent(ctx, action = action))),
                                    horizontalAlignment = Alignment.CenterHorizontally, verticalAlignment = Alignment.CenterVertically) {
                                    Text(icon, style = TextStyle(fontSize = 20.sp))
                                    Text(label, style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                        color = if (action == "new") GlanceTheme.colors.onPrimary else GlanceTheme.colors.onSurface))
                                }
                                if (i < row.size - 1) Spacer(GlanceModifier.width(2.dp))
                            }
                        }
                    }
                }
            }
}

class QuickWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = QuickWidget() }

// ---------- 2. Tasks: tick off to-dos from every note without opening the app ----------

private val NoteKey = ActionParameters.Key<String>("note")
private val BlockKey = ActionParameters.Key<String>("block")

/** Ticks a to-do from a widget; the change syncs like any other edit. */
class ToggleTaskAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val note = parameters[NoteKey] ?: return
        val block = parameters[BlockKey] ?: return
        (context.applicationContext as PliopadApp).repo.toggleTask(note, block)
        Widgets.refreshNow(context)
    }
}

class TasksWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val app = context.applicationContext as PliopadApp
        val ws = signedInWs(context)
        val today = LocalDate.now().toString()
        val tasks = if (ws == null) emptyList() else app.dao.notesWithTodosList(ws)
            .flatMap { Blocks.openTasks(it.id, it.title, Blocks.parse(it.content)) }
            .sortedWith(compareBy({ it.due == null }, { it.due }))
        provideContent { TasksContent(ws != null, tasks, today) }
    }
}

@Composable
internal fun TasksContent(signedIn: Boolean, tasks: List<Blocks.Task>, today: String) {
            WidgetFrame {
                val ctx = LocalContext.current
                Column(GlanceModifier.fillMaxSize()) {
                    val overdue = tasks.count { it.due != null && it.due < today }
                    Header(if (overdue > 0) "Tasks · $overdue overdue" else "Tasks · ${tasks.size}", "Open" to actionStartActivity(openIntent(ctx, action = "tasks")))
                    if (!signedIn) Muted("Sign in to PlioPad")
                    else if (tasks.isEmpty()) Muted("All done 🎉  Add “[ ]” to any note.")
                    else LazyColumn(GlanceModifier.fillMaxSize()) {
                        items(tasks.take(40), itemId = { (it.noteId + it.blockId).hashCode().toLong() }) { t ->
                            Row(GlanceModifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                                CheckBox(checked = false, onCheckedChange = actionRunCallback<ToggleTaskAction>(actionParametersOf(NoteKey to t.noteId, BlockKey to t.blockId)))
                                Column(GlanceModifier.defaultWeight().clickable(actionStartActivity(openIntent(ctx, note = t.noteId)))) {
                                    Text(t.text.replace(Regex("@\\d{4}-\\d{2}-\\d{2}"), "").trim(), maxLines = 2, style = TextStyle(fontSize = 14.sp, color = GlanceTheme.colors.onSurface))
                                    Text(t.noteTitle.ifBlank { "Untitled" }, maxLines = 1, style = TextStyle(fontSize = 11.sp, color = GlanceTheme.colors.onSurfaceVariant))
                                }
                                t.due?.let { d ->
                                    val bg = when { d < today -> GlanceTheme.colors.errorContainer; d == today -> GlanceTheme.colors.tertiaryContainer; else -> GlanceTheme.colors.surfaceVariant }
                                    Text(if (d == today) "Today" else d.drop(5), style = TextStyle(fontSize = 11.sp, color = GlanceTheme.colors.onSurface),
                                        modifier = GlanceModifier.cornerRadius(8.dp).background(bg).padding(horizontal = 6.dp, vertical = 2.dp))
                                }
                            }
                        }
                    }
                }
            }
}

class TasksWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = TasksWidget() }

// ---------- 3. Pinned note: any note on the home screen; its checklists can be ticked in place ----------

object NoteWidgetPrefs {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("note_widgets", Context.MODE_PRIVATE)
    fun get(ctx: Context, appWidgetId: Int): String? = prefs(ctx).getString("w$appWidgetId", null)
    fun set(ctx: Context, appWidgetId: Int, noteId: String) = prefs(ctx).edit().putString("w$appWidgetId", noteId).apply()
}

class NoteWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val app = context.applicationContext as PliopadApp
        val appWidgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
        val note: NoteEntity? = NoteWidgetPrefs.get(context, appWidgetId)?.let { app.dao.note(it) }?.takeIf { !it.deleted && it.trashedAt == null }
        provideContent { NoteContent(note) }
    }
}

@Composable
internal fun NoteContent(note: NoteEntity?) {
            val blocks = note?.let { Blocks.parse(it.content) }.orEmpty()
            WidgetFrame {
                val ctx = LocalContext.current
                Column(GlanceModifier.fillMaxSize()) {
                    if (note == null) {
                        Header("Pinned note")
                        Muted("The note was removed. Remove this widget and add it again to pick another.")
                        return@Column
                    }
                    Header("${note.icon?.plus(" ") ?: ""}${note.title.ifBlank { "Untitled" }}", "Edit" to actionStartActivity(openIntent(ctx, note = note.id)))
                    LazyColumn(GlanceModifier.fillMaxSize()) {
                        items(blocks.filter { it.t != "hr" && (it.x.isNotBlank() || it.t == "todo") }.take(60), itemId = { it.id.hashCode().toLong() }) { b ->
                            val text = Blocks.inlineToPlain(b.x)
                            val indent = (b.indent * 12).dp
                            when (b.t) {
                                "todo" -> Row(GlanceModifier.fillMaxWidth().padding(start = indent), verticalAlignment = Alignment.CenterVertically) {
                                    CheckBox(checked = b.checked, onCheckedChange = actionRunCallback<ToggleTaskAction>(actionParametersOf(NoteKey to note.id, BlockKey to b.id)))
                                    Text(text, style = TextStyle(fontSize = 14.sp, color = if (b.checked) GlanceTheme.colors.onSurfaceVariant else GlanceTheme.colors.onSurface,
                                        textDecoration = if (b.checked) TextDecoration.LineThrough else TextDecoration.None))
                                }
                                "h1", "h2", "h3" -> Text(text, style = TextStyle(fontSize = if (b.t == "h1") 17.sp else 15.sp, fontWeight = FontWeight.Bold, color = GlanceTheme.colors.onSurface),
                                    modifier = GlanceModifier.padding(top = 6.dp, bottom = 2.dp))
                                "ul", "ol" -> Text("•  $text", style = TextStyle(fontSize = 14.sp, color = GlanceTheme.colors.onSurface), modifier = GlanceModifier.padding(start = indent, top = 2.dp, bottom = 2.dp))
                                else -> Text(text, style = TextStyle(fontSize = 14.sp, color = GlanceTheme.colors.onSurface), modifier = GlanceModifier.padding(start = indent, top = 2.dp, bottom = 2.dp))
                            }
                        }
                    }
                }
            }
}

class NoteWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = NoteWidget() }

// ---------- 4. Pinned & recent ----------

class ShortcutsWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val app = context.applicationContext as PliopadApp
        val ws = signedInWs(context)
        val pinned = if (ws == null) emptyList() else app.dao.pinnedList(ws)
        val recent = if (ws == null) emptyList() else app.dao.recent(ws, 12).filter { r -> pinned.none { it.id == r.id } }
        provideContent { ShortcutsContent(ws != null, pinned, recent) }
    }
}

@Composable
internal fun ShortcutsContent(signedIn: Boolean, pinned: List<NoteEntity>, recent: List<NoteEntity>) {
            WidgetFrame {
                val ctx = LocalContext.current
                Column(GlanceModifier.fillMaxSize()) {
                    Header("PlioPad", "+ Note" to actionStartActivity(openIntent(ctx, action = "new")))
                    if (!signedIn) { Muted("Sign in to PlioPad"); return@Column }
                    LazyColumn(GlanceModifier.fillMaxSize()) {
                        if (pinned.isNotEmpty()) item { Section("★  Pinned") }
                        items(pinned.take(12), itemId = { ("p" + it.id).hashCode().toLong() }) { NoteLine(ctx, it) }
                        if (recent.isNotEmpty()) item { Section("Recently edited") }
                        items(recent.take(10), itemId = { ("r" + it.id).hashCode().toLong() }) { NoteLine(ctx, it) }
                    }
                }
            }
}

@Composable private fun Section(label: String) =
        Text(label, style = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, color = GlanceTheme.colors.onSurfaceVariant), modifier = GlanceModifier.padding(top = 6.dp, bottom = 2.dp))

@Composable private fun NoteLine(ctx: Context, n: NoteEntity) =
        Row(GlanceModifier.fillMaxWidth().padding(vertical = 5.dp).clickable(actionStartActivity(openIntent(ctx, note = n.id))), verticalAlignment = Alignment.CenterVertically) {
            Text(n.icon ?: if (n.kind == "db") "▦" else "📄", style = TextStyle(fontSize = 14.sp), modifier = GlanceModifier.width(26.dp))
            Text(n.title.ifBlank { "Untitled" }, maxLines = 1, style = TextStyle(fontSize = 14.sp, color = GlanceTheme.colors.onSurface))
        }

class ShortcutsWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = ShortcutsWidget() }

// ---------- 5. PlioSphere: a live picture of how your notes connect ----------

class GraphWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val app = context.applicationContext as PliopadApp
        val ws = signedInWs(context)
        val graph = if (ws == null) null else app.dao.allNotesList(ws).let { GraphModel.build(it, maxNodes = 90, tagNames = app.dao.tags(ws).first().associate { t -> t.id to t.name }) }
        provideContent { GraphContent(graph) }
    }
}

@Composable
internal fun GraphContent(graph: GraphModel.Graph?) {
    val ctx = LocalContext.current
    val size = LocalSize.current
    val density = ctx.resources.displayMetrics.density
    GlanceTheme(colors = WidgetColors) {
        Column(GlanceModifier.fillMaxSize().background(Color(0xFF101D59)).cornerRadius(22.dp).padding(12.dp)
            .clickable(actionStartActivity(openIntent(ctx, action = "graph")))) {
            Row(GlanceModifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(GraphModel.NAME, style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp, color = androidx.glance.unit.ColorProvider(Color.White)), modifier = GlanceModifier.defaultWeight())
                if (graph != null) Text("${graph.nodes.size} notes · ${graph.edges.size} links", style = TextStyle(fontSize = 11.sp, color = androidx.glance.unit.ColorProvider(Color(0xFF83EBC0))))
            }
            if (graph == null) { Text("Sign in to PlioPad", style = TextStyle(fontSize = 13.sp, color = androidx.glance.unit.ColorProvider(Color(0xFFAEB6E0)))); return@Column }
            if (graph.nodes.isEmpty()) { Text("Link notes with [[ to see them connect.", style = TextStyle(fontSize = 13.sp, color = androidx.glance.unit.ColorProvider(Color(0xFFAEB6E0)))); return@Column }
            // Rendered at real pixel size (capped to stay well under the widget bitmap limit).
            val w = (size.width.value - 24).coerceAtLeast(80f); val h = (size.height.value - 48).coerceAtLeast(60f)
            val scale = (density * minOf(1f, 560f / maxOf(w, h)))
            val bmp = GraphModel.render(graph, (w * scale).toInt(), (h * scale).toInt(), scale)
            androidx.glance.Image(androidx.glance.ImageProvider(bmp), contentDescription = "PlioSphere: your linked notes", modifier = GlanceModifier.fillMaxSize().cornerRadius(14.dp))
        }
    }
}

class GraphWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = GraphWidget() }

// ---------- Keeping widgets current ----------

object Widgets {
    private val scope = CoroutineScope(Dispatchers.Default)
    private var pending: Job? = null

    /** After an edit or a sync: refresh every widget, at most once every couple of seconds while someone is typing. */
    fun refreshSoon(ctx: Context) {
        val app = ctx.applicationContext
        pending?.cancel()
        pending = scope.launch { delay(1500); refreshNow(app) }
    }

    suspend fun refreshNow(ctx: Context) {
        runCatching {
            QuickWidget().updateAll(ctx)
            TasksWidget().updateAll(ctx)
            NoteWidget().updateAll(ctx)
            ShortcutsWidget().updateAll(ctx)
            GraphWidget().updateAll(ctx)
        }
    }
}

