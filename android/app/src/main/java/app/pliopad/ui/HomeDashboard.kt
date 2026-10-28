package app.pliopad.ui

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.isSystemInDarkTheme
import app.pliopad.PliopadApp
import app.pliopad.core.Block
import app.pliopad.core.Blocks
import app.pliopad.data.NoteEntity
import app.pliopad.data.SessionData
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Date

/** Recently opened notes, kept on the phone for the "Recently visited" row. */
object Visits {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("visits", Context.MODE_PRIVATE)
    fun track(ctx: Context, ws: Long, id: String) {
        val list = listOf(id) + get(ctx, ws).filter { it != id }
        prefs(ctx).edit().putString("ws$ws", list.take(24).joinToString(",")).apply()
    }
    fun get(ctx: Context, ws: Long): List<String> = prefs(ctx).getString("ws$ws", "")!!.split(',').filter { it.isNotBlank() }
}

/** Which widgets the person hid with Customize. */
object HomePrefs {
    val WIDGETS = listOf("recent" to "Recently visited", "scratch" to "Scratch pad", "tasks" to "Tasks", "shortcuts" to "Shortcuts",
        "reminders" to "Reminders", "notebooks" to "Notebooks", "edited" to "Recently edited")
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("home", Context.MODE_PRIVATE)
    fun hidden(ctx: Context): Set<String> = prefs(ctx).getStringSet("hidden", emptySet())!!
    fun setHidden(ctx: Context, v: Set<String>) = prefs(ctx).edit().putStringSet("hidden", v).apply()
}

const val SCRATCH_TITLE = "Scratch pad"

private fun scratchText(blocks: List<Block>): String {
    var n = 0
    return blocks.joinToString("\n") { b ->
        n = if (b.t == "ol") n + 1 else 0
        val pad = "  ".repeat(b.indent)
        when (b.t) {
            "todo" -> "$pad- [${if (b.checked) "x" else " "}] "; "ul" -> "$pad- "; "ol" -> "$pad$n. "
            "h1" -> "# "; "h2" -> "## "; "h3" -> "### "; "quote" -> "> "; else -> pad
        } + b.x
    }
}

/** Text → blocks, reusing the old block ids line by line so edits on other devices merge instead of replacing. */
private fun scratchBlocks(text: String, old: List<Block>): List<Block> =
    Blocks.fromMarkdown(text).mapIndexed { i, b -> old.getOrNull(i)?.let { o -> b.copy(id = o.id, u = if (o.t == b.t && o.x == b.x) o.u else System.currentTimeMillis()) } ?: b }

/** One widget on Home: a title row and its content, drawn as a quiet rounded card. */
private class Widget(val key: String, val title: String, val icon: ImageVector, val action: Pair<String, () -> Unit>? = null, val content: @Composable () -> Unit)

@OptIn(ExperimentalLayoutApi::class, kotlinx.coroutines.FlowPreview::class)
@Composable
fun HomeDashboard(
    app: PliopadApp, s: SessionData, onOpen: (String) -> Unit, onList: (String, String) -> Unit, onCreate: () -> Unit,
    quickActions: List<Pair<String, () -> Unit>>, onCustomize: () -> Unit, hidden: Set<String>,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val ws = s.workspace?.id ?: 0
    val dao = app.dao
    val all by dao.allNotes(ws).collectAsState(initial = emptyList())
    val pinned by dao.pinnedNotes(ws).collectAsState(initial = emptyList())
    val reminders by dao.reminderNotes(ws).collectAsState(initial = emptyList())
    val notebooks by dao.notebooks(ws).collectAsState(initial = emptyList())
    val todoNotes by dao.notesWithTodos(ws).collectAsState(initial = emptyList())
    val tasks = remember(todoNotes) { todoNotes.flatMap { Blocks.openTasks(it.id, it.title, Blocks.parse(it.content)) } }
    val visited = remember(all) { Visits.get(ctx, ws).mapNotNull { id -> all.firstOrNull { it.id == id } } }
    val recent = (visited + all.sortedByDescending { it.updatedAt }.filter { it !in visited }).filter { it.title != SCRATCH_TITLE }.take(12)
    val cs = MaterialTheme.colorScheme
    val hour = LocalTime.now().hour
    val greeting = when { hour < 5 -> "Good evening"; hour < 12 -> "Good morning"; hour < 18 -> "Good afternoon"; else -> "Good evening" }
    val first = s.user?.name?.substringBefore(' ').orEmpty()
    val today = LocalDate.now().toString()
    val dueRe = remember { Regex("@\\d{4}-\\d{2}-\\d{2}") }

    val widgets = listOf(
        Widget("scratch", SCRATCH_TITLE, Icons.Default.EditNote) { ScratchPad(app, all) },
        Widget("tasks", "Tasks", Icons.Default.CheckBox, if (tasks.isNotEmpty()) "View all" to { onList("tasks", "-") } else null) {
            if (tasks.isEmpty()) Empty("Nothing to do. Add “[ ]” to a note.")
            tasks.sortedWith(compareBy({ it.due == null }, { it.due })).take(6).forEach { t ->
                Row(Modifier.fillMaxWidth().clickable { onOpen(t.noteId) }.heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(false, { scope.launch { app.repo.toggleTask(t.noteId, t.blockId) } }, Modifier.size(32.dp), colors = CheckboxDefaults.colors(uncheckedColor = cs.outline))
                    Text(t.text.replace(dueRe, "").trim(), Modifier.weight(1f).padding(start = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 15.sp)
                    t.due?.let { d ->
                        val (bg, label) = when { d < today -> Color(0x33EF4444) to d.drop(5); d == today -> Color(0x33F97316) to "Today"; else -> cs.surfaceVariant to d.drop(5) }
                        Text(label, Modifier.background(bg, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp), fontSize = 12.sp)
                    }
                }
            }
        },
        Widget("shortcuts", "Shortcuts", Icons.Default.Star) {
            if (pinned.isEmpty()) Empty("Star a note to pin it here.")
            pinned.take(6).forEach { NoteLine(it, null) { onOpen(it.id) } }
        },
        Widget("reminders", "Reminders", Icons.Default.Notifications) {
            val upcoming = reminders.filter { !it.reminderDone }.take(5)
            if (upcoming.isEmpty()) Empty("No upcoming reminders.")
            upcoming.forEach { n -> NoteLine(n, DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(n.reminderAt!!))) { onOpen(n.id) } }
        },
        Widget("notebooks", "Notebooks", Icons.AutoMirrored.Filled.MenuBook) {
            if (notebooks.isEmpty()) Empty("No notebooks yet.")
            notebooks.take(8).forEach { nb ->
                val count = all.count { it.notebookId == nb.id }
                Row(Modifier.fillMaxWidth().clickable { onList("nb", nb.id) }.heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(nb.icon ?: "📓", Modifier.width(28.dp))
                    Text(nb.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 15.sp)
                    Text(count.toString(), fontSize = 12.sp, color = cs.onSurfaceVariant)
                }
            }
        },
        Widget("edited", "Recently edited", Icons.Default.Schedule) {
            all.sortedByDescending { it.updatedAt }.take(6).forEach { n -> NoteLine(n, relative(n.updatedAt)) { onOpen(n.id) } }
        },
    ).filter { it.key !in hidden }

    // Sized from the pane it sits in (it can be a narrow left pane on an unfolded screen), not from the whole screen.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val roomy = maxWidth >= 600.dp
        val columns = when { maxWidth >= 1050.dp -> 3; maxWidth >= 600.dp -> 2; else -> 1 }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 1040.dp).fillMaxWidth().padding(horizontal = if (roomy) 32.dp else 16.dp).padding(top = 8.dp, bottom = 40.dp)) {
                // The greeting is the page title (the top bar stays empty on Home, like Notion).
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, MMMM d")), color = cs.onSurfaceVariant, fontSize = 14.sp)
                        Text("$greeting${if (first.isNotBlank()) ", $first" else ""}", fontSize = if (roomy) 30.sp else 26.sp, lineHeight = if (roomy) 36.sp else 31.sp,
                            fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
                    }
                    IconButton(onClick = onCustomize) { Icon(Icons.Default.Tune, "Customize Home", tint = cs.onSurfaceVariant) }
                }
                // Quick actions wrap onto a second line instead of running off the edge.
                FlowRow(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    quickActions.forEachIndexed { i, (label, run) ->
                        Surface(onClick = run, shape = RoundedCornerShape(20.dp), color = if (i == 0) cs.primary else cs.surfaceVariant.copy(alpha = .7f)) {
                            Text(label, Modifier.padding(horizontal = 14.dp, vertical = 9.dp), fontSize = 14.sp, fontWeight = FontWeight.Medium,
                                color = if (i == 0) cs.onPrimary else cs.onSurface)
                        }
                    }
                }

                if ("recent" !in hidden && recent.isNotEmpty()) {
                    SectionLabel(Icons.Default.History, "Recently visited", Modifier.padding(top = 28.dp, bottom = 10.dp))
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        recent.forEach { n -> RecentCard(n) { onOpen(n.id) } }
                    }
                }

                // Widgets: tidy cards in 1–3 columns.
                Spacer(Modifier.height(24.dp))
                val cols = columns.coerceAtMost(widgets.size.coerceAtLeast(1))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    for (c in 0 until cols) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            widgets.filterIndexed { i, _ -> i % cols == c }.forEach { WidgetCard(it) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(icon: ImageVector, title: String, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(16.dp), tint = cs.onSurfaceVariant)
        Text(title, Modifier.padding(start = 6.dp), color = cs.onSurfaceVariant, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun WidgetCard(w: Widget) {
    val cs = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(14.dp), color = cs.surfaceVariant.copy(alpha = .35f), border = BorderStroke(1.dp, cs.outlineVariant.copy(alpha = .6f)),
        modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 14.dp, end = 10.dp, top = 6.dp, bottom = 10.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 36.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(w.icon, null, Modifier.size(16.dp), tint = cs.onSurfaceVariant)
                Text(w.title, Modifier.padding(start = 8.dp).weight(1f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                w.action?.let { (label, run) -> Text(label, Modifier.clickable(onClick = run).padding(horizontal = 6.dp, vertical = 4.dp), color = cs.primary, fontSize = 13.sp) }
            }
            w.content()
        }
    }
}

@Composable
private fun Empty(text: String) = Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .8f), fontSize = 14.sp, modifier = Modifier.padding(vertical = 6.dp))

@Composable
private fun NoteLine(n: NoteEntity, meta: String?, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(n.icon ?: if (n.kind == "db") "▦" else "📄", Modifier.width(28.dp))
        Text(n.title.ifBlank { "Untitled" }, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 15.sp)
        meta?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun RecentCard(n: NoteEntity, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Surface(onClick = onClick, shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, cs.outlineVariant.copy(alpha = .7f)), color = cs.surface,
        modifier = Modifier.size(144.dp, 112.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(n.icon ?: if (n.kind == "db") "▦" else "📄", fontSize = 22.sp)
            Text(n.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.weight(1f))
            Text(relative(n.updatedAt), fontSize = 11.sp, color = cs.onSurfaceVariant)
        }
    }
}

/** The scratch pad is a real note (titled "Scratch pad"), so it works offline and syncs with the web app's Home. */
@OptIn(kotlinx.coroutines.FlowPreview::class)
@Composable
private fun ScratchPad(app: PliopadApp, all: List<NoteEntity>) {
    val note = all.firstOrNull { it.title == SCRATCH_TITLE }
    var text by remember(note?.id) { mutableStateOf(note?.let { scratchText(Blocks.parse(it.content)) } ?: "") }
    var noteId by remember(note?.id) { mutableStateOf(note?.id) }
    LaunchedEffect(noteId) {
        snapshotFlow { text }.drop(1).debounce(700).collect { t ->
            val id = noteId
            if (id == null) {
                val created = app.repo.createNote(title = SCRATCH_TITLE, blocks = Blocks.fromMarkdown(t), useDefaultNotebook = false)
                app.repo.setIcon(created, "🗒️")
                noteId = created
            } else {
                val old = Blocks.parse(app.dao.note(id)?.content)
                app.repo.saveContent(id, SCRATCH_TITLE, scratchBlocks(t, old))
            }
        }
    }
    val cs = MaterialTheme.colorScheme
    BasicTextField(text, { text = it },
        textStyle = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary),
        modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(top = 2.dp, bottom = 4.dp, end = 4.dp),
        decorationBox = { inner -> Box { if (text.isEmpty()) Text("Jot something down…", color = cs.onSurfaceVariant.copy(alpha = .7f), fontSize = 15.sp); inner() } })
}
