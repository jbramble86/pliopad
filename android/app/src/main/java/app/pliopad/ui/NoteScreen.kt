package app.pliopad.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.pliopad.PliopadApp
import app.pliopad.core.Block
import app.pliopad.core.Blocks
import app.pliopad.data.NoteEntity
import app.pliopad.scan.Scanner
import app.pliopad.work.Reminders
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.text.DateFormat
import java.util.Calendar
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class, kotlinx.coroutines.FlowPreview::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun NoteScreen(id: String, app: PliopadApp, ai: Boolean, onBack: () -> Unit, openNote: (String) -> Unit, inPane: Boolean = false) {
    val layout = LocalLayout.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val repo = app.repo
    val note by app.dao.noteFlow(id).collectAsState(initial = null)
    val n = note ?: return
    val ws = n.wsId
    val notebooks by app.dao.notebooks(ws).collectAsState(initial = emptyList())
    val tags by app.dao.tags(ws).collectAsState(initial = emptyList())
    val titles by app.dao.titles(ws).collectAsState(initial = emptyList())
    val parent by app.dao.noteFlow(n.parentId ?: "-").collectAsState(initial = null)
    val readOnly = n.trashedAt != null || n.locked
    LaunchedEffect(id) { Visits.track(ctx, n.wsId, id) }

    // Editor state is created once per note; later changes from sync are applied when we have nothing unsaved.
    val editor = remember(id) { EditorState(Blocks.parse(n.content)) }
    var title by remember(id) { mutableStateOf(n.title) }
    var lastSaved by remember(id) { mutableStateOf(n.content to n.title) }
    LaunchedEffect(n.content, n.title) {
        val mine = Blocks.encode(editor.content())
        if (n.content != lastSaved.first && n.content != mine && !n.dirty) {
            editor.replaceAll(Blocks.parse(n.content))
            title = n.title
            lastSaved = n.content to n.title
        }
    }
    // Autosave shortly after typing stops, and when leaving the screen.
    suspend fun save() {
        val content = Blocks.encode(editor.content())
        if (content == lastSaved.first && title == lastSaved.second) return
        lastSaved = content to title
        repo.saveContent(id, title, editor.content())
    }
    LaunchedEffect(id) { snapshotFlow { editor.version to title }.debounce(700).collect { if (!readOnly) save() } }
    DisposableEffect(id) { onDispose { app.scope.launch { if (!readOnly) save() } } }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        uri?.let { editor.insertBlocks(listOf(Block(t = "img", src = repo.importImage(it)))) }
    }
    val scanLauncher = Scanner.rememberScanLauncher { pages ->
        scope.launch {
            val text = pages.map { Scanner.recognize(ctx, it) }.joinToString("\n\n")
            editor.insertBlocks(Scanner.blocksFor(pages.map { repo.importImage(it) }, text))
            Toast.makeText(ctx, "Scanned ${pages.size} page${if (pages.size == 1) "" else "s"}", Toast.LENGTH_SHORT).show()
        }
    }
    var menu by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<String?>(null) }
    var aiText by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(notebooks.firstOrNull { it.id == n.notebookId }?.name ?: parent?.title ?: "", style = MaterialTheme.typography.titleSmall) },
                navigationIcon = { IconButton(onClick = { scope.launch { save(); onBack() } }) { if (inPane) Icon(Icons.Default.Close, "Close note") else Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                actions = {
                    if (!n.dirty) Text("Synced", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    IconButton(onClick = { scope.launch { repo.setPinned(id, !n.pinned) } }) {
                        Icon(if (n.pinned) Icons.Default.Star else Icons.Default.StarBorder, "Shortcut", tint = if (n.pinned) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (ai) IconButton(onClick = { dialog = "ai" }) { Icon(Icons.Default.AutoAwesome, "AI") }
                    IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "More") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (n.trashedAt == null) {
                            DropdownMenuItem(text = { Text("Move to notebook") }, onClick = { menu = false; dialog = "move" })
                            DropdownMenuItem(text = { Text("Tags") }, onClick = { menu = false; dialog = "tags" })
                            DropdownMenuItem(text = { Text(if (n.reminderAt != null) "Change reminder" else "Add reminder") }, onClick = { menu = false; pickReminder(ctx) { at -> scope.launch { repo.setReminder(id, at); Reminders.scheduleAll(ctx, listOf(Triple(id, title, at))) } } })
                            if (n.reminderAt != null) DropdownMenuItem(text = { Text("Remove reminder") }, onClick = { menu = false; scope.launch { repo.setReminder(id, null); Reminders.cancel(ctx, id) } })
                            if (!readOnly) DropdownMenuItem(text = { Text("Change created date") }, onClick = { menu = false; pickDateTime(ctx, n.createdAt, past = true) { at -> scope.launch { repo.setCreated(id, at) } } })
                            DropdownMenuItem(text = { Text(if (n.icon == null) "Add icon" else "Change icon") }, onClick = { menu = false; dialog = "icon" })
                            DropdownMenuItem(text = { Text("Add a page inside") }, onClick = { menu = false; scope.launch { save(); openNote(repo.createNote(parentId = id, notebookId = null, useDefaultNotebook = false)) } })
                            DropdownMenuItem(text = { Text("Comments") }, onClick = { menu = false; dialog = "comments" })
                            DropdownMenuItem(text = { Text("Version history") }, onClick = { menu = false; dialog = "history" })
                            DropdownMenuItem(text = { Text(if (n.shareSlug != null) "Published to the web" else "Publish to the web") }, onClick = { menu = false; dialog = "publish" })
                            DropdownMenuItem(text = { Text("Duplicate") }, onClick = { menu = false; scope.launch { save(); repo.duplicate(id)?.let(openNote) } })
                            DropdownMenuItem(text = { Text(if (n.isTemplate) "Stop using as template" else "Save as template") }, onClick = { menu = false; scope.launch { repo.setTemplate(id, !n.isTemplate) } })
                            DropdownMenuItem(text = { Text(if (n.locked) "Unlock page" else "Lock page") }, onClick = { menu = false; scope.launch { save(); repo.update(id) { it.copy(locked = !n.locked) } } })
                            DropdownMenuItem(text = { Text("Share as text") }, onClick = {
                                menu = false
                                ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, title)
                                    .putExtra(Intent.EXTRA_TEXT, title + "\n\n" + Blocks.plain(editor.blocks.toList())), "Share"))
                            })
                            DropdownMenuItem(text = { Text("Move to trash") }, onClick = { menu = false; scope.launch { save(); repo.trash(id); onBack() } })
                        } else {
                            DropdownMenuItem(text = { Text("Restore") }, onClick = { menu = false; scope.launch { repo.restore(id) } })
                            DropdownMenuItem(text = { Text("Delete forever") }, onClick = { menu = false; scope.launch { repo.deleteForever(id); onBack() } })
                        }
                    }
                },
            )
        },
        bottomBar = { if (!readOnly && (editor.focusId != null || layout.tabletop)) Column(Modifier.imePadding()) { EditorToolbar(editor, onInsert = { dialog = "insert" }, onImage = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, onScan = { scope.launch { Scanner.start(ctx as android.app.Activity) { scanLauncher.launch(it) } } }) } },
    ) { pad ->
        // Comfortable reading width on big screens; in tabletop posture the page stays above the fold.
        // Tapping anywhere that isn't text or a button (blank space, margins, below the last line) starts typing at the end.
        Box(Modifier.padding(pad).fillMaxSize().let { m -> layout.tabletopTopDp?.let { m.heightIn(max = (it - 64.dp).coerceAtLeast(200.dp)) } ?: m }
            .pointerInput(readOnly) { if (!readOnly) detectTapGestures { editor.focusEnd() } }, contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 780.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = if (layout.twoPane) 36.dp else 20.dp, vertical = 8.dp)) {
            if (n.trashedAt != null) Text("This note is in the trash.", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 8.dp))
            if (n.locked) Text("🔒 Locked to prevent accidental edits. Unlock it from the ⋮ menu.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
            n.icon?.let { Text(it, fontSize = 40.sp, modifier = Modifier.clickable(enabled = !readOnly) { dialog = "icon" }) }
            BasicTextField(
                value = title, onValueChange = { title = it.replace("\n", " ") }, readOnly = readOnly,
                textStyle = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                decorationBox = { inner -> if (title.isEmpty()) Text("Untitled", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .5f)); inner() },
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
            )
            // Tags and reminder
            val noteTags = repo.tagsOf(n)
            if (noteTags.isNotEmpty() || n.reminderAt != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                noteTags.mapNotNull { t -> tags.firstOrNull { it.id == t } }.forEach { AssistChip(onClick = { dialog = "tags" }, label = { Text("#" + it.name) }) }
                n.reminderAt?.let { AssistChip(onClick = {}, label = { Text("⏰ " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it))) }) }
            }
            // Database row: show its properties
            if (parent?.kind == "db") PropsPanel(app, n, parent!!)
            Spacer(Modifier.height(8.dp))
            BlockEditor(editor, readOnly,
                noteTitle = { nid -> titles.firstOrNull { it.id == nid }?.let { (it.icon?.plus(" ") ?: "") + it.title.ifBlank { "Untitled" } } },
                openNote = { nid -> scope.launch { save(); openNote(nid) } },
                openUrl = { url -> runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } })
            if (n.kind == "db") DatabaseRows(app, n, openNote = { rid -> scope.launch { save(); openNote(rid) } })
            // Pages this note links to (inline links aren't tappable while editing), and pages that link here.
            val linked = Blocks.links(editor.blocks.toList()).mapNotNull { lid -> titles.firstOrNull { it.id == lid } }
            val backlinks by app.dao.backlinks(ws, id).collectAsState(initial = emptyList())
            if (linked.isNotEmpty() || backlinks.isNotEmpty()) {
                HorizontalDivider(Modifier.padding(top = 24.dp, bottom = 8.dp))
                if (linked.isNotEmpty()) {
                    Text("LINKED PAGES", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    linked.forEach { l -> Text("↗ ${l.icon?.plus(" ") ?: ""}${l.title.ifBlank { "Untitled" }}", Modifier.fillMaxWidth().clickable { scope.launch { save(); openNote(l.id) } }.padding(vertical = 8.dp)) }
                }
                if (backlinks.isNotEmpty()) {
                    Text("${backlinks.size} BACKLINK${if (backlinks.size == 1) "" else "S"}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    backlinks.forEach { b -> Text("${b.icon ?: "📄"} ${b.title.ifBlank { "Untitled" }}", Modifier.fillMaxWidth().clickable { scope.launch { save(); openNote(b.id) } }.padding(vertical = 8.dp)) }
                }
            }
            Spacer(Modifier.height(240.dp))
        }
        }
    }

    // "[[" typed in the editor: pick the page to link.
    if (editor.linkTrigger != null) PagePicker(app, ws, exclude = id, onDismiss = { editor.linkTrigger = null }, onCreate = { name ->
        scope.launch { val nid = repo.createNote(title = name, notebookId = n.notebookId); editor.insertLink(nid, name) }
    }) { p -> editor.insertLink(p.id, p.title.ifBlank { "Untitled" }) }

    when (dialog) {
        "icon" -> EmojiDialog(onDismiss = { dialog = null }) { e -> scope.launch { repo.setIcon(id, e) } }
        "insert" -> ActionSheet("Insert", listOf(
            SheetAction("Link to a page", emoji = "↗") { editor.linkTrigger = (editor.focusId ?: editor.blocks.last().id) to editor.blocks.first { it.id == (editor.focusId ?: editor.blocks.last().id) }.x.length },
            SheetAction("Sub-page", emoji = "📄") { scope.launch { save(); val cid = repo.createNote(parentId = id, notebookId = null, useDefaultNotebook = false); editor.insertBlocks(listOf(Block(t = "page", x = "Untitled", src = cid))); openNote(cid) } },
            SheetAction("Divider", emoji = "—") { editor.insertBlocks(listOf(Block(t = "hr"), Block())) },
            SheetAction("Web bookmark", emoji = "🔗") { dialog = "bookmark" },
            SheetAction("Image", emoji = "🖼") { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            SheetAction("Scan a document", emoji = "📷") { scope.launch { Scanner.start(ctx as android.app.Activity) { scanLauncher.launch(it) } } },
            SheetAction("Today's date", emoji = "📅") { editor.insertText("@" + java.time.LocalDate.now() + " ") },
        )) { if (dialog == "insert") dialog = null }
        "bookmark" -> PromptDialog("Add a web bookmark", label = "Link", ok = "Add", onDismiss = { dialog = null }) { url ->
            val src = if (url.startsWith("http")) url else "https://$url"
            editor.insertBlocks(listOf(Block(t = "bookmark", x = src.removePrefix("https://").removePrefix("http://").substringBefore('/'), src = src)))
        }
        "comments" -> CommentsSheet(app, ws, id) { dialog = null }
        "history" -> HistorySheet(app, ws, id, readOnly) { restored ->
            dialog = null
            if (restored != null) { editor.replaceAll(Blocks.parse(restored.content)); title = restored.title; lastSaved = restored.content to restored.title }
        }
        "publish" -> PublishDialog(app, ws, n) { dialog = null }
        "move" ->AlertDialog(onDismissRequest = { dialog = null }, confirmButton = { TextButton(onClick = { dialog = null }) { Text("Close") } }, title = { Text("Move to notebook") },
            text = { Column { notebooks.forEach { nb -> Text("${nb.icon ?: "📓"}  ${nb.name}", Modifier.fillMaxWidth().clickable { scope.launch { repo.moveTo(id, nb.id) }; dialog = null }.padding(vertical = 12.dp),
                fontWeight = if (nb.id == n.notebookId) FontWeight.Bold else FontWeight.Normal) } } })
        "tags" -> {
            var newTag by remember { mutableStateOf("") }
            val current = repo.tagsOf(n)
            AlertDialog(onDismissRequest = { dialog = null }, confirmButton = { TextButton(onClick = { dialog = null }) { Text("Done") } }, title = { Text("Tags") },
                text = { Column {
                    tags.forEach { t ->
                        val on = t.id in current
                        Text((if (on) "✓  " else "    ") + "#" + t.name, Modifier.fillMaxWidth().clickable { scope.launch { repo.setTags(id, if (on) current - t.id else current + t.id) } }.padding(vertical = 10.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(newTag, { newTag = it }, Modifier.weight(1f), placeholder = { Text("New tag") }, singleLine = true)
                        IconButton(onClick = { if (newTag.isNotBlank()) scope.launch { val tid = repo.createTag(newTag); repo.setTags(id, current + tid); newTag = "" } }) { Icon(Icons.Default.Add, "Add tag") }
                    }
                } })
        }
        "ai" -> AlertDialog(onDismissRequest = { dialog = null; aiText = null }, title = { Text("✨ AI") },
            confirmButton = { if (aiText != null && !readOnly) TextButton(onClick = { editor.insertBlocks(Blocks.fromMarkdown(aiText!!)); dialog = null; aiText = null }) { Text("Insert") } },
            dismissButton = { TextButton(onClick = { dialog = null; aiText = null }) { Text("Close") } },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    if (aiText == null) listOf("summarize" to "Summarize", "actions" to "Find action items", "continue" to "Continue writing").forEach { (action, label) ->
                        Text(label, Modifier.fillMaxWidth().clickable {
                            aiText = "Thinking…"
                            scope.launch {
                                save()
                                app.sync.runCatching { run(ws) } // make sure the server has the latest text
                                aiText = runCatching { app.api.ai(ws, action, id).markdown ?: "" }.getOrElse { "AI needs a connection: ${it.message}" }
                            }
                        }.padding(vertical = 12.dp))
                    } else Text(aiText!!)
                }
            })
    }
}

private fun pickReminder(ctx: android.content.Context, onPicked: (Long) -> Unit) {
    val c = Calendar.getInstance().apply { add(Calendar.DAY_OF_MONTH, 1); set(Calendar.HOUR_OF_DAY, 9); set(Calendar.MINUTE, 0) }
    pickDateTime(ctx, c.timeInMillis, past = false, onPicked)
}

/** Date then time pickers, starting at [start]. With [past], future dates can't be picked (creation dates). */
private fun pickDateTime(ctx: android.content.Context, start: Long, past: Boolean, onPicked: (Long) -> Unit) {
    val c = Calendar.getInstance().apply { timeInMillis = start }
    val dialog = DatePickerDialog(ctx, { _, y, m, d ->
        TimePickerDialog(ctx, { _, hh, mm -> c.set(y, m, d, hh, mm, 0); onPicked(if (past) minOf(c.timeInMillis, System.currentTimeMillis()) else c.timeInMillis) }, c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), true).show()
    }, c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH))
    if (past) dialog.datePicker.maxDate = System.currentTimeMillis()
    dialog.show()
}

private data class Prop(val id: String, val name: String, val type: String, val options: List<Pair<String, String>>)

private fun schemaProps(raw: String?): List<Prop> = runCatching {
    Blocks.json.parseToJsonElement(raw ?: "{}").jsonObject["props"]!!.jsonArray.map { p ->
        val o = p.jsonObject
        Prop(o["id"]!!.jsonPrimitive.content, o["name"]!!.jsonPrimitive.content, o["type"]!!.jsonPrimitive.content,
            (o["options"] as? JsonArray)?.map { (it as JsonObject).let { x -> x["id"]!!.jsonPrimitive.content to x["name"]!!.jsonPrimitive.content } } ?: emptyList())
    }
}.getOrDefault(emptyList())

/** Properties of a database row (status, dates, text…), editable in place. */
@Composable
private fun PropsPanel(app: PliopadApp, n: NoteEntity, db: NoteEntity) {
    val scope = rememberCoroutineScope()
    val values = app.repo.propsOf(n)
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        HorizontalDivider()
        schemaProps(db.dbSchema).forEach { p ->
            var open by remember { mutableStateOf(false) }
            var editing by remember { mutableStateOf(false) }
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(p.name, Modifier.width(110.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                val v = values[p.id]
                val shown = when (p.type) {
                    "select", "status" -> p.options.firstOrNull { it.first == v }?.second
                    "person" -> v?.let { "Member #$it" }
                    else -> v
                } ?: "Empty"
                Column {
                    Text(shown, Modifier.clickable { if (p.options.isNotEmpty()) open = true else if (p.type in setOf("text", "number", "date", "url")) editing = true },
                        color = if (v == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                    DropdownMenu(open, { open = false }) {
                        p.options.forEach { (oid, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { open = false; scope.launch { app.repo.setProp(n.id, p.id, oid) } }) }
                        DropdownMenuItem(text = { Text("Clear") }, onClick = { open = false; scope.launch { app.repo.setProp(n.id, p.id, null) } })
                    }
                }
            }
            if (editing) {
                var text by remember { mutableStateOf(values[p.id] ?: "") }
                AlertDialog(onDismissRequest = { editing = false }, title = { Text(p.name) },
                    text = { OutlinedTextField(text, { text = it }, singleLine = true, placeholder = { Text(if (p.type == "date") "YYYY-MM-DD" else "") }) },
                    confirmButton = { TextButton(onClick = { editing = false; scope.launch { app.repo.setProp(n.id, p.id, text.ifBlank { null }) } }) { Text("Save") } })
            }
        }
        HorizontalDivider()
    }
}

/** Rows of a database page as a Board (grouped by its first status/select property), a Table or a List. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun DatabaseRows(app: PliopadApp, db: NoteEntity, openNote: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val rows by app.dao.children(db.id).collectAsState(initial = emptyList())
    val props = schemaProps(db.dbSchema)
    val group = props.firstOrNull { it.type == "status" || it.type == "select" }
    var view by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(if (group != null) "board" else "table") }
    val repo = app.repo
    fun display(p: Prop, v: String?): String = when {
        v == null -> ""
        p.options.isNotEmpty() -> p.options.firstOrNull { it.first == v }?.second ?: ""
        p.type == "checkbox" -> if (v == "true") "☑" else "☐"
        else -> v
    }
    val newRow: (Map<String, String>) -> Unit = { preset ->
        scope.launch {
            val rid = repo.createNote(parentId = db.id, notebookId = db.notebookId, useDefaultNotebook = false)
            preset.forEach { (k, v) -> repo.setProp(rid, k, v) }
            openNote(rid)
        }
    }
    Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            listOfNotNull("board".takeIf { group != null }, "table", "list").forEach { v ->
                androidx.compose.material3.FilterChip(selected = view == v, onClick = { view = v }, label = { Text(v.replaceFirstChar { it.uppercase() }) })
            }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { newRow(emptyMap()) }) { Icon(Icons.Default.Add, null); Text(" New") }
        }
        when (view) {
            "board" -> if (group != null) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                (group.options.map { it.first to it.second } + listOf<Pair<String?, String>>(null to "No ${group.name}")).forEach { (oid, name) ->
                    val items = rows.filter { repo.propsOf(it)[group.id] == oid }
                    if (oid == null && items.isEmpty()) return@forEach
                    Column(Modifier.width(230.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp)).padding(8.dp)) {
                        Text("$name  ${items.size}", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(4.dp))
                        items.forEach { r ->
                            var move by remember { mutableStateOf(false) }
                            androidx.compose.material3.Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable { openNote(r.id) }) {
                                Column(Modifier.padding(10.dp)) {
                                    Text("${r.icon?.plus(" ") ?: ""}${r.title.ifBlank { "Untitled" }}", fontWeight = FontWeight.Medium)
                                    val values = repo.propsOf(r)
                                    props.filter { it.id != group.id && values[it.id] != null }.take(2).forEach { p ->
                                        Text("${p.name}: ${display(p, values[p.id])}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    Box {
                                        AssistChip(onClick = { move = true }, label = { Text(name) })
                                        DropdownMenu(move, { move = false }) {
                                            group.options.forEach { (o, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { move = false; scope.launch { repo.setProp(r.id, group.id, o) } }) }
                                        }
                                    }
                                }
                            }
                        }
                        TextButton(onClick = { newRow(oid?.let { mapOf(group.id to it) } ?: emptyMap()) }) { Text("+ New") }
                    }
                }
            }
            "table" -> Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
                val cell = Modifier.width(140.dp).padding(horizontal = 8.dp, vertical = 10.dp)
                Row { Text("Name", cell.width(180.dp), fontWeight = FontWeight.SemiBold); props.forEach { Text(it.name, cell, fontWeight = FontWeight.SemiBold, maxLines = 1) } }
                HorizontalDivider()
                rows.forEach { r ->
                    val values = repo.propsOf(r)
                    Row(Modifier.clickable { openNote(r.id) }) {
                        Text("${r.icon ?: "📄"} ${r.title.ifBlank { "Untitled" }}", cell.width(180.dp), maxLines = 1)
                        props.forEach { p -> Text(display(p, values[p.id]), cell, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    HorizontalDivider()
                }
            }
            else -> rows.forEach { r ->
                val values = repo.propsOf(r)
                Row(Modifier.fillMaxWidth().clickable { openNote(r.id) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${r.icon ?: "📄"}  ${r.title.ifBlank { "Untitled" }}", Modifier.weight(1f))
                    group?.let { g -> Text(display(g, values[g.id]), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                HorizontalDivider()
            }
        }
        if (rows.isEmpty()) Text("No rows yet. Tap New to add one.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
    }
}
