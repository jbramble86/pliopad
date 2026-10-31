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
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.layout.fillMaxHeight
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
import java.time.format.DateTimeFormatter
import java.util.Date

/** Recently opened notes, kept on the phone for the "Jump back in" row. */
object Visits {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("visits", Context.MODE_PRIVATE)
    fun track(ctx: Context, ws: Long, id: String) {
        val list = listOf(id) + get(ctx, ws).filter { it != id }
        prefs(ctx).edit().putString("ws$ws", list.take(24).joinToString(",")).apply()
    }
    fun get(ctx: Context, ws: Long): List<String> = prefs(ctx).getString("ws$ws", "")!!.split(',').filter { it.isNotBlank() }
}

/** Which widgets the person hid with Customize. */
/** The Home layout: which sections show, in what order. Saved to the account (same on web, Windows and Android), cached here for offline. */
data class HomeLayout(val order: List<String>, val hidden: Set<String>)

object HomePrefs {
    val WIDGETS = listOf("actions" to "Quick actions", "recent" to "Jump back in", "scratch" to "Quick jot", "tasks" to "Tasks", "shortcuts" to "Pinned",
        "reminders" to "Reminders", "notebooks" to "Notebooks", "updated" to "Recently edited")
    val LABEL = WIDGETS.toMap()
    /** Full-width sections; the rest sit side by side in columns. */
    val WIDE = setOf("actions", "recent")
    val DEFAULT = HomeLayout(WIDGETS.map { it.first }, emptySet())
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("home", Context.MODE_PRIVATE)
    // Older builds called "Recently edited" "edited".
    private fun key(k: String) = if (k == "edited") "updated" else k

    /** Every known section once, unknown ones dropped, new ones appended. */
    private fun normalize(order: List<String>, hidden: Collection<String>) =
        HomeLayout((order.map(::key).filter { it in LABEL } + DEFAULT.order).distinct(), hidden.map(::key).filter { it in LABEL }.toSet())

    fun layout(ctx: Context): HomeLayout {
        val p = prefs(ctx)
        return normalize(p.getString("order", null)?.split(',').orEmpty(), p.getStringSet("hidden", emptySet())!!)
    }

    private fun cache(ctx: Context, l: HomeLayout) = prefs(ctx).edit().putString("order", l.order.joinToString(",")).putStringSet("hidden", l.hidden).apply()

    /** Takes the layout from the account, if it has one. */
    fun fromAccount(ctx: Context, accountPrefs: kotlinx.serialization.json.JsonObject?): HomeLayout {
        val home = accountPrefs?.get("home") as? kotlinx.serialization.json.JsonObject ?: return layout(ctx)
        fun list(name: String) = (home[name] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }.orEmpty()
        return normalize(list("order"), list("hidden")).also { cache(ctx, it) }
    }

    suspend fun save(ctx: Context, api: app.pliopad.data.Api, l: HomeLayout) {
        cache(ctx, l)
        runCatching {
            api.savePrefs(kotlinx.serialization.json.buildJsonObject {
                put("home", kotlinx.serialization.json.buildJsonObject {
                    put("order", kotlinx.serialization.json.JsonArray(l.order.map { kotlinx.serialization.json.JsonPrimitive(it) }))
                    put("hidden", kotlinx.serialization.json.JsonArray(l.hidden.map { kotlinx.serialization.json.JsonPrimitive(it) }))
                })
            })
        }
    }
}

/** Customize Home: show or hide each section and move it up or down. Changes apply as you make them. */
@Composable
fun CustomizeHomeDialog(layout: HomeLayout, onChange: (HomeLayout) -> Unit, onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Customize Home") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("Your layout is saved to your account and used on every device.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 8.dp))
                layout.order.forEachIndexed { i, k ->
                    val shown = k !in layout.hidden
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(shown, { onChange(layout.copy(hidden = if (shown) layout.hidden + k else layout.hidden - k)) })
                        Text(HomePrefs.LABEL[k] ?: k, Modifier.weight(1f), color = if (shown) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                        IconButton(onClick = { onChange(layout.copy(order = layout.order.toMutableList().apply { add(i - 1, removeAt(i)) })) }, enabled = i > 0) {
                            Icon(Icons.Default.KeyboardArrowUp, "Move up")
                        }
                        IconButton(onClick = { onChange(layout.copy(order = layout.order.toMutableList().apply { add(i + 1, removeAt(i)) })) }, enabled = i < layout.order.size - 1) {
                            Icon(Icons.Default.KeyboardArrowDown, "Move down")
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
        dismissButton = { TextButton(onClick = { onChange(HomePrefs.DEFAULT) }) { Text("Reset") } },
    )
}

const val SCRATCH_TITLE = "Quick jot"
/** Quick jot notes created before the rename are still found. */
fun isScratch(n: NoteEntity) = n.title == SCRATCH_TITLE || n.title == "Scratch pad"

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

/** Each Home section has its own colour (same on web and Windows). */
private val ACCENT = mapOf("scratch" to Color(0xFFF5A524), "tasks" to Color(0xFF647BFF), "shortcuts" to Color(0xFF9B7BFF),
    "reminders" to Color(0xFFFF7A70), "notebooks" to Color(0xFF2FBF8A), "updated" to Color(0xFF3BA7FF), "recent" to Color(0xFF647BFF))
private val TINTS = listOf(0xFF647BFF, 0xFF2FBF8A, 0xFFFF7A70, 0xFFF5A524, 0xFF9B7BFF, 0xFF3BA7FF, 0xFFEC6FB0).map { Color(it) }
/** A steady colour per note or notebook, from its id. */
private fun tint(id: String?): Color = TINTS[((id ?: "").fold(7L) { a, c -> (a * 31 + c.code) and 0xFFFFFFFFL } % TINTS.size).toInt()]

private val LATE = Color(0xFFEF4444)
private val TODAY = Color(0xFFF5A524)
private val SOON = Color(0xFF647BFF)

/** At a glance: how many to-dos are overdue, due today, coming up or undated. */
@Composable
private fun TaskSummary(tasks: List<Blocks.Task>, today: String) {
    val cs = MaterialTheme.colorScheme
    val groups = listOf(Triple("Overdue", LATE, tasks.count { it.due != null && it.due < today }), Triple("Today", TODAY, tasks.count { it.due == today }),
        Triple("Upcoming", SOON, tasks.count { it.due != null && it.due > today }), Triple("No date", cs.outlineVariant, tasks.count { it.due == null })).filter { it.third > 0 }
    Row(Modifier.fillMaxWidth().padding(top = 2.dp).height(8.dp).clip(RoundedCornerShape(4.dp)), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        groups.forEach { (_, color, n) -> Box(Modifier.weight(n.toFloat()).fillMaxHeight().background(color)) }
    }
    FlowRow(Modifier.padding(top = 8.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        groups.forEach { (label, color, n) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).background(color, RoundedCornerShape(2.dp)))
                Text("$n", Modifier.padding(start = 5.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                Text(" $label", fontSize = 12.sp, color = cs.onSurfaceVariant)
            }
        }
    }
}

/** Notes edited per day over the last two weeks, as small bars. */
@Composable
private fun Activity(all: List<NoteEntity>) {
    val start = remember { java.time.LocalDate.now().atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }
    val day = 86_400_000L
    val counts = IntArray(14).also { c -> all.forEach { n -> val d = ((start + day - n.updatedAt) / day).toInt(); if (n.updatedAt <= start + day && d in 0..13) c[13 - d]++ } }
    val max = (counts.maxOrNull() ?: 0).coerceAtLeast(1)
    val blue = ACCENT.getValue("updated")
    Row(Modifier.fillMaxWidth().height(44.dp).padding(top = 2.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
        counts.forEachIndexed { i, c ->
            Box(Modifier.weight(1f).fillMaxHeight((c.toFloat() / max).coerceAtLeast(.08f)).background(if (i == 13) blue else blue.copy(alpha = .35f), RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)))
        }
    }
}

/** A pinned note as a small coloured tile. */
@Composable
private fun PinTile(n: NoteEntity, modifier: Modifier, onClick: () -> Unit) {
    val t = tint(n.id)
    Surface(onClick = onClick, shape = RoundedCornerShape(12.dp), color = t.copy(alpha = .12f), border = BorderStroke(1.dp, t.copy(alpha = .28f)), modifier = modifier.heightIn(min = 74.dp)) {
        Column(Modifier.padding(10.dp)) {
            Text(n.icon ?: if (n.kind == "db") "▦" else "📄", fontSize = 20.sp)
            Text(n.title.ifBlank { "Untitled" }, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 17.sp,
                modifier = Modifier.padding(top = 6.dp))
        }
    }
}

/** A reminder with a little calendar chip for its date. */
@Composable
private fun ReminderLine(n: NoteEntity, onClick: () -> Unit) {
    val coral = ACCENT.getValue("reminders")
    val at = java.time.Instant.ofEpochMilli(n.reminderAt!!).atZone(java.time.ZoneId.systemDefault())
    val due = n.reminderAt < System.currentTimeMillis()
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.size(38.dp, 40.dp).background(if (due) coral else coral.copy(alpha = .14f), RoundedCornerShape(9.dp)),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(at.format(DateTimeFormatter.ofPattern("MMM")).uppercase(), fontSize = 9.sp, fontWeight = FontWeight.SemiBold, letterSpacing = .6.sp, lineHeight = 10.sp,
                color = if (due) Color.White else Color(0xFFE2554B))
            Text(at.dayOfMonth.toString(), fontSize = 16.sp, fontWeight = FontWeight.Bold, lineHeight = 18.sp, color = if (due) Color.White else Color(0xFFE2554B))
        }
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Text(n.title.ifBlank { "Untitled" }, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 15.sp)
            Text(at.format(DateTimeFormatter.ofPattern("EEE h:mm a")), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class, kotlinx.coroutines.FlowPreview::class)
@Composable
fun HomeDashboard(
    app: PliopadApp, s: SessionData, onOpen: (String) -> Unit, onList: (String, String) -> Unit, onCreate: () -> Unit,
    quickActions: List<Pair<String, () -> Unit>>, onCustomize: () -> Unit, layout: HomeLayout,
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
    val recent = (visited + all.sortedByDescending { it.updatedAt }.filter { it !in visited }).filter { !isScratch(it) }.take(12)
    val cs = MaterialTheme.colorScheme
    val first = s.user?.name?.substringBefore(' ').orEmpty()
    val today = LocalDate.now().toString()
    val dueRe = remember { Regex("@\\d{4}-\\d{2}-\\d{2}") }

    val widgets = listOf(
        Widget("scratch", SCRATCH_TITLE, Icons.Default.EditNote) { ScratchPad(app, all) },
        Widget("tasks", "Tasks", Icons.Default.CheckBox, if (tasks.isNotEmpty()) "View all" to { onList("tasks", "-") } else null) {
            if (tasks.isEmpty()) Empty("Nothing to do. Add “[ ]” to a note.") else TaskSummary(tasks, today)
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
        Widget("shortcuts", "Pinned", Icons.Default.Star) {
            if (pinned.isEmpty()) Empty("Star a note to pin it here.")
            pinned.take(6).chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { n -> PinTile(n, Modifier.weight(1f)) { onOpen(n.id) } }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        },
        Widget("reminders", "Reminders", Icons.Default.Notifications) {
            val upcoming = reminders.filter { !it.reminderDone }.take(5)
            if (upcoming.isEmpty()) Empty("No upcoming reminders.")
            upcoming.forEach { n -> ReminderLine(n) { onOpen(n.id) } }
        },
        Widget("notebooks", "Notebooks", Icons.AutoMirrored.Filled.MenuBook) {
            if (notebooks.isEmpty()) Empty("No notebooks yet.")
            val counts = notebooks.associate { nb -> nb.id to all.count { it.notebookId == nb.id } }
            val most = (counts.values.maxOrNull() ?: 0).coerceAtLeast(1)
            notebooks.take(8).forEach { nb ->
                val count = counts[nb.id] ?: 0
                val t = tint(nb.id)
                Row(Modifier.fillMaxWidth().clickable { onList("nb", nb.id) }.heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(34.dp).background(t.copy(alpha = .16f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) { Text(nb.icon ?: "📓", fontSize = 17.sp) }
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(nb.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 15.sp)
                            Text(if (count == 1) "1 note" else "$count notes", fontSize = 12.sp, color = cs.onSurfaceVariant)
                        }
                        Box(Modifier.padding(top = 5.dp).fillMaxWidth().height(4.dp).background(cs.outlineVariant.copy(alpha = .5f), RoundedCornerShape(2.dp))) {
                            Box(Modifier.fillMaxWidth((count.toFloat() / most).coerceAtLeast(.04f)).fillMaxHeight().background(t, RoundedCornerShape(2.dp)))
                        }
                    }
                }
            }
        },
        Widget("updated", "Recently edited", Icons.Default.Schedule) {
            Activity(all)
            all.sortedByDescending { it.updatedAt }.take(5).forEach { n -> NoteLine(n, relative(n.updatedAt)) { onOpen(n.id) } }
        },
    ).associateBy { it.key }

    // Sized from the pane it sits in (it can be a narrow left pane on an unfolded screen), not from the whole screen.
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val roomy = maxWidth >= 600.dp
        val columns = when { maxWidth >= 1050.dp -> 3; maxWidth >= 600.dp -> 2; else -> 1 }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 1040.dp).fillMaxWidth().padding(horizontal = if (roomy) 32.dp else 16.dp).padding(top = 8.dp, bottom = if (LocalPill.current != null) PillClearance else 40.dp)) {
                // The greeting is the page title (the top bar stays empty on Home).
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, MMMM d")), color = cs.onSurfaceVariant, fontSize = 14.sp)
                        Text(if (first.isNotBlank()) "Hi $first, here's your day" else "Here's your day", fontSize = if (roomy) 30.sp else 26.sp, lineHeight = if (roomy) 36.sp else 31.sp,
                            fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
                    }
                    IconButton(onClick = onCustomize) { Icon(Icons.Default.Tune, "Customize Home", tint = cs.onSurfaceVariant) }
                }
                // Sections in the saved order: wide ones on their own, runs of the others as cards in 1–3 columns.
                val groups = mutableListOf<List<String>>()
                for (k in layout.order.filter { it !in layout.hidden }) {
                    val last = groups.lastOrNull()
                    if (last == null || k in HomePrefs.WIDE || last.first() in HomePrefs.WIDE) groups += listOf(k) else groups[groups.lastIndex] = last + k
                }
                groups.forEach { group ->
                    when (group.first()) {
                        // Quick actions wrap onto a second line instead of running off the edge.
                        "actions" -> FlowRow(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            quickActions.forEachIndexed { i, (label, run) ->
                                Surface(onClick = run, shape = RoundedCornerShape(20.dp), color = if (i == 0) cs.primary else cs.surfaceVariant.copy(alpha = .7f)) {
                                    Text(label, Modifier.padding(horizontal = 14.dp, vertical = 9.dp), fontSize = 14.sp, fontWeight = FontWeight.Medium,
                                        color = if (i == 0) cs.onPrimary else cs.onSurface)
                                }
                            }
                        }
                        "recent" -> if (recent.isNotEmpty()) {
                            SectionLabel(Icons.Default.History, "Jump back in", Modifier.padding(top = 28.dp, bottom = 10.dp))
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                recent.forEach { n -> RecentCard(n) { onOpen(n.id) } }
                            }
                        }
                        else -> {
                            val cards = group.mapNotNull { widgets[it] }
                            Spacer(Modifier.height(24.dp))
                            val cols = columns.coerceAtMost(cards.size.coerceAtLeast(1))
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                for (c in 0 until cols) {
                                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                        cards.filterIndexed { i, _ -> i % cols == c }.forEach { WidgetCard(it) }
                                    }
                                }
                            }
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
    val accent = ACCENT[w.key] ?: cs.primary
    Surface(shape = RoundedCornerShape(16.dp), color = cs.surface, border = BorderStroke(1.dp, accent.copy(alpha = .25f)), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.background(androidx.compose.ui.graphics.Brush.verticalGradient(0f to accent.copy(alpha = .10f), 1f to Color.Transparent, endY = 360f))
            .padding(start = 14.dp, end = 10.dp, top = 10.dp, bottom = 12.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(28.dp).background(accent.copy(alpha = .16f), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                    Icon(w.icon, null, Modifier.size(16.dp), tint = accent)
                }
                Text(w.title, Modifier.padding(start = 10.dp).weight(1f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
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
        modifier = Modifier.size(144.dp, 118.dp)) {
        // A Column, not loose children: Surface stretches each child to the full card height.
        Column {
        Box(Modifier.fillMaxWidth().height(6.dp).background(androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(tint(n.notebookId ?: n.id), tint((n.notebookId ?: n.id) + "x")))))
        Column(Modifier.weight(1f).padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 12.dp)) {
            Text(n.icon ?: if (n.kind == "db") "▦" else "📄", fontSize = 22.sp)
            Text(n.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.weight(1f))
            Text(relative(n.updatedAt), fontSize = 11.sp, color = cs.onSurfaceVariant)
        }
        }
    }
}

/** Quick jot is a real note (titled "Quick jot"), so it works offline and syncs with the web app's Home. */
@OptIn(kotlinx.coroutines.FlowPreview::class)
@Composable
private fun ScratchPad(app: PliopadApp, all: List<NoteEntity>) {
    val note = all.firstOrNull { isScratch(it) }
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
        modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp).padding(top = 2.dp, bottom = 2.dp, end = 4.dp)
            .background(Color(0xFFF5A524).copy(alpha = .06f), RoundedCornerShape(10.dp))
            .border(1.dp, Color(0xFFF5A524).copy(alpha = .25f), RoundedCornerShape(10.dp))
            .drawBehind {
                val step = 22.sp.toPx()
                var y = 6.dp.toPx() + step
                while (y < size.height) { drawLine(Color(0xFFF5A524).copy(alpha = .22f), androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(size.width, y), 1f); y += step }
            }
            .padding(horizontal = 10.dp, vertical = 6.dp),
        decorationBox = { inner -> Box { if (text.isEmpty()) Text("Jot something down…", color = cs.onSurfaceVariant.copy(alpha = .7f), fontSize = 15.sp); inner() } })
}
