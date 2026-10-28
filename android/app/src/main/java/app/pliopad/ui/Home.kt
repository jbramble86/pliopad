package app.pliopad.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.key
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.DriveFileMove
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.LibraryAdd
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.RemoveCircleOutline
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material.icons.automirrored.filled.ViewQuilt
import androidx.compose.material3.Button
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import app.pliopad.PliopadApp
import app.pliopad.data.NoteEntity
import app.pliopad.data.NotebookEntity
import app.pliopad.data.SessionData
import app.pliopad.data.TagEntity
import app.pliopad.work.SyncWorker
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/** What the home screen is showing a dialog or sheet for. */
private sealed interface HomeDialog {
    data class NotebookActions(val nb: NotebookEntity) : HomeDialog
    data class StackActions(val stack: String) : HomeDialog
    data class TagActions(val tag: TagEntity) : HomeDialog
    data class NoteActions(val note: NoteEntity) : HomeDialog
    data class RenameNotebook(val nb: NotebookEntity) : HomeDialog
    data class NotebookIcon(val nb: NotebookEntity) : HomeDialog
    data class MoveToStack(val nb: NotebookEntity) : HomeDialog
    data class NewStackFor(val nb: NotebookEntity?) : HomeDialog
    data class NewNotebook(val stack: String?) : HomeDialog
    data class AddToStack(val stack: String) : HomeDialog
    data class RemoveFromStack(val stack: String) : HomeDialog
    data class RenameStack(val stack: String) : HomeDialog
    data class UngroupStack(val stack: String) : HomeDialog
    data class DeleteNotebook(val nb: NotebookEntity) : HomeDialog
    data class RenameTag(val tag: TagEntity) : HomeDialog
    data class MoveNote(val note: NoteEntity) : HomeDialog
    data object NewMenu : HomeDialog
    data object EmptyTrash : HomeDialog
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    app: PliopadApp, s: SessionData, nav: NavHostController, initialType: String, initialArg: String, startScan: () -> Unit,
    selected: MutableState<String?>,
) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val layout = LocalLayout.current
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val ws = s.workspace?.id ?: 0
    val dao = app.dao
    val repo = app.repo
    // The list shown is plain state, so switching lists from the sidebar never navigates (no transition, no half-closed drawer).
    var type by rememberSaveable { mutableStateOf(initialType) }
    var arg by rememberSaveable { mutableStateOf(initialArg) }
    val notebooks by dao.notebooks(ws).collectAsState(initial = emptyList())
    val tags by dao.tags(ws).collectAsState(initial = emptyList())
    val pages by dao.topPages(ws).collectAsState(initial = emptyList())
    val templates by dao.templates(ws).collectAsState(initial = emptyList())
    val pending by dao.pendingCount(ws).collectAsState(initial = 0)
    val sync by dao.syncStateFlow(ws).collectAsState(initial = null)
    val flow: Flow<List<NoteEntity>> = remember(type, arg, ws) {
        when (type) {
            "nb" -> dao.notebookNotes(ws, arg)
            "tag" -> dao.tagNotes(ws, arg)
            "pinned" -> dao.pinnedNotes(ws)
            "reminders" -> dao.reminderNotes(ws)
            "trash" -> dao.trashNotes(ws)
            "templates" -> dao.templates(ws)
            else -> dao.allNotes(ws)
        }
    }
    val raw by flow.collectAsState(initial = emptyList())
    var sort by rememberSaveable { mutableStateOf("updated") }
    val notes = remember(raw, sort) {
        when (sort) {
            "title" -> raw.sortedBy { it.title.lowercase() }
            "created" -> raw.sortedByDescending { it.createdAt }
            else -> raw.sortedWith(compareByDescending<NoteEntity> { it.pinned }.thenByDescending { it.updatedAt })
        }
    }
    val currentNb = notebooks.firstOrNull { it.id == arg }.takeIf { type == "nb" }
    val currentTag = tags.firstOrNull { it.id == arg }.takeIf { type == "tag" }
    val title = when (type) {
        "home" -> "Home"
        "nb" -> currentNb?.let { "${it.icon ?: "📓"} ${it.name}" } ?: "Notebook"
        "tag" -> "#" + (currentTag?.name ?: "")
        "pinned" -> "Shortcuts"; "reminders" -> "Reminders"; "trash" -> "Trash"; "templates" -> "Templates"
        else -> "All notes"
    }
    var refreshing by remember { mutableStateOf(false) }
    var wsMenu by remember { mutableStateOf(false) }
    var sortMenu by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<HomeDialog?>(null) }
    var customizing by remember { mutableStateOf(false) }
    var hiddenWidgets by remember { mutableStateOf(HomePrefs.hidden(ctx)) }
    val closedStacks = remember { mutableStateOf(setOf<String>()) }
    val openPages = remember { mutableStateOf(setOf<String>()) }
    // Three panes need room: at fold sizes the sidebar tucks into the drawer while a note is open (like Notion); from 1100dp it always stays.
    val permanent = layout.widthDp >= 1100 || (layout.permanentSidebar && selected.value == null)
    val twoPane = layout.twoPane

    /** Opens a note: beside the list on unfolded screens, full screen on a phone. */
    val open: (String) -> Unit = { id -> if (twoPane) selected.value = id else nav.navigate("note/$id") }
    /** Sidebar navigation. The drawer finishes closing first, then the screen changes. */
    val go: (String) -> Unit = { route ->
        scope.launch {
            if (!permanent && drawer.isOpen) drawer.close()
            when {
                route.startsWith("list/") -> route.split('/').let { p -> type = p[1]; arg = p.getOrElse(2) { "-" } }
                route.startsWith("note/") -> open(route.removePrefix("note/"))
                else -> nav.navigate(route) { launchSingleTop = true }
            }
        }
    }
    val stackNames = notebooks.mapNotNull { it.stack }.distinct().sorted()
    BackHandler(enabled = (twoPane && selected.value != null) || type != "home" || drawer.isOpen) {
        when {
            drawer.isOpen -> scope.launch { drawer.close() }
            twoPane && selected.value != null -> selected.value = null
            else -> { type = "home"; arg = "-" }
        }
    }
    val newNote: () -> Unit = {
        scope.launch {
            val id = repo.createNote(notebookId = currentNb?.id, useDefaultNotebook = true)
            if (currentTag != null) repo.setTags(id, listOf(currentTag.id))
            if (type == "pinned") repo.setPinned(id, true)
            if (type == "templates") repo.setTemplate(id, true)
            open(id)
        }
    }
    // The floating pill bar's "+" creates in this list's context; its long-press opens the create menu.
    val pill = LocalPill.current
    if (pill != null) {
        val latestNew by rememberUpdatedState(newNote)
        DisposableEffect(pill) {
            pill.onNew = { latestNew() }
            pill.onNewMenu = { dialog = HomeDialog.NewMenu }
            onDispose { pill.onNew = null; pill.onNewMenu = null }
        }
        LaunchedEffect(pill) { snapshotFlow { drawer.targetValue == DrawerValue.Open }.collect { pill.drawerOpen = it } }
        DisposableEffect(pill) { onDispose { pill.drawerOpen = false } }
    }

    val sidebar: @Composable () -> Unit = {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 10.dp)) {
            // Workspace switcher
            Box {
                Row(Modifier.fillMaxWidth().clickable { wsMenu = true }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(color = MaterialTheme.colorScheme.primary, shape = MaterialTheme.shapes.small, modifier = Modifier.size(30.dp)) {
                        Box(contentAlignment = Alignment.Center) { Text(s.workspace?.name?.take(1)?.uppercase() ?: "P", color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold) }
                    }
                    Column(Modifier.padding(start = 10.dp).weight(1f)) {
                        Text(s.workspace?.name ?: "PlioPad", fontWeight = FontWeight.SemiBold, maxLines = 1)
                        Text(s.user?.email ?: "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                    Icon(Icons.Default.ExpandMore, null)
                }
                DropdownMenu(wsMenu, { wsMenu = false }) {
                    s.workspaces.forEach { w -> DropdownMenuItem(text = { Text(w.name, fontWeight = if (w.id == ws) FontWeight.Bold else FontWeight.Normal) },
                        onClick = { wsMenu = false; scope.launch { app.session.setWorkspace(w.id); SyncWorker.requestSoon(app, 0) } }) }
                }
            }
            DrawerRow("Home", { Icon(Icons.Default.Home, null) }, selected = type == "home") { go("list/home/-") }
            DrawerRow("All notes", { Icon(Icons.AutoMirrored.Filled.Notes, null) }, selected = type == "all") { go("list/all/-") }
            DrawerRow("Shortcuts", { Icon(Icons.Default.Star, null) }, selected = type == "pinned") { go("list/pinned/-") }
            DrawerRow("Tasks", { Icon(Icons.Default.CheckBox, null) }) { go("tasks") }
            DrawerRow("Reminders", { Icon(Icons.Default.Notifications, null) }, selected = type == "reminders") { go("list/reminders/-") }
            DrawerRow("Graph", { Icon(Icons.Default.Hub, null) }) { go("graph") }
            if (s.ai) DrawerRow("Ask AI", { Icon(Icons.Default.AutoAwesome, null) }) { go("ask") }

            // Notebooks, grouped into stacks. Long-press any notebook or stack for its actions.
            SectionHeader("Notebooks") {
                IconButton(onClick = { dialog = HomeDialog.NewNotebook(null) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Add, "New notebook", Modifier.size(18.dp)) }
                IconButton(onClick = { dialog = HomeDialog.NewStackFor(null) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.LibraryAdd, "New stack", Modifier.size(18.dp)) }
            }
            @Composable
            fun nbRow(nb: NotebookEntity, indent: Int) = DrawerRow(nb.name, { Text(nb.icon ?: "📓") }, selected = type == "nb" && arg == nb.id, indent = indent,
                trailing = { IconButton(onClick = { dialog = HomeDialog.NotebookActions(nb) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.MoreVert, "Notebook options", Modifier.size(18.dp)) } },
                onLongClick = { dialog = HomeDialog.NotebookActions(nb) }) { go("list/nb/${nb.id}") }
            notebooks.filter { it.stack == null }.forEach { nbRow(it, 0) }
            stackNames.forEach { stack ->
                val isOpen = stack !in closedStacks.value
                val members = notebooks.filter { it.stack == stack }
                DrawerRow("$stack  (${members.size})", { Icon(if (isOpen) Icons.Default.FolderOpen else Icons.Default.Folder, null) },
                    trailing = { IconButton(onClick = { dialog = HomeDialog.StackActions(stack) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.MoreVert, "Stack options", Modifier.size(18.dp)) } },
                    onLongClick = { dialog = HomeDialog.StackActions(stack) }) {
                    closedStacks.value = if (isOpen) closedStacks.value + stack else closedStacks.value - stack
                }
                if (isOpen) members.forEach { nbRow(it, 1) }
            }
            if (notebooks.isEmpty()) DrawerRow("Create a notebook", { Icon(Icons.Default.Add, null) }) { dialog = HomeDialog.NewNotebook(null) }

            // Pages: a tree of pages outside notebooks.
            SectionHeader("Pages") {
                IconButton(onClick = { scope.launch { if (drawer.isOpen) drawer.close(); open(repo.createNote(useDefaultNotebook = false)) } }, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Add, "New page", Modifier.size(18.dp)) }
            }
            pages.forEach { p -> PageTreeRow(app, p, 0, openPages, onOpen = { go("note/$it") }) }
            if (pages.isEmpty()) Text("Pages without a notebook appear here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 4.dp))

            if (tags.isNotEmpty()) {
                SectionHeader("Tags")
                tags.forEach { t -> DrawerRow("#" + t.name, {}, selected = type == "tag" && arg == t.id, onLongClick = { dialog = HomeDialog.TagActions(t) }) { go("list/tag/${t.id}") } }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            DrawerRow("Templates", { Icon(Icons.AutoMirrored.Filled.ViewQuilt, null) }, selected = type == "templates") { go("list/templates/-") }
            DrawerRow("Trash", { Icon(Icons.Default.Delete, null) }, selected = type == "trash") { go("list/trash/-") }
            DrawerRow("Settings", { Icon(Icons.Default.Settings, null) }) { go("settings") }
            Spacer(Modifier.height(24.dp))
        }
    }

    val listPane: @Composable () -> Unit = {
        Scaffold(
            topBar = {
                TopAppBar(title = { if (type != "home") Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    navigationIcon = { if (!permanent) IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Default.Menu, "Menu") } },
                    actions = {
                        Icon(if (pending > 0) Icons.Default.CloudUpload else Icons.Default.CloudDone, if (pending > 0) "$pending changes waiting to sync" else "Synced",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 4.dp))
                        IconButton(onClick = { nav.navigate("search") }) { Icon(Icons.Default.Search, "Search") }
                        if (type != "home") Box {
                            IconButton(onClick = { sortMenu = true }) { Icon(Icons.AutoMirrored.Filled.Sort, "Sort") }
                            DropdownMenu(sortMenu, { sortMenu = false }) {
                                listOf("updated" to "Date updated", "created" to "Date created", "title" to "Title").forEach { (k, l) ->
                                    DropdownMenuItem(text = { Text((if (sort == k) "✓  " else "     ") + l) }, onClick = { sort = k; sortMenu = false })
                                }
                            }
                        }
                        when {
                            currentNb != null -> IconButton(onClick = { dialog = HomeDialog.NotebookActions(currentNb) }) { Icon(Icons.Default.MoreVert, "Notebook options") }
                            currentTag != null -> IconButton(onClick = { dialog = HomeDialog.TagActions(currentTag) }) { Icon(Icons.Default.MoreVert, "Tag options") }
                            type == "trash" && notes.isNotEmpty() -> TextButton(onClick = { dialog = HomeDialog.EmptyTrash }) { Text("Empty", color = MaterialTheme.colorScheme.error) }
                        }
                    })
            },
            floatingActionButton = {
                // On phones the pill bar's "+" replaces these buttons.
                if (pill == null && type != "trash" && type != "home") Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SmallFloatingActionButton(onClick = { dialog = HomeDialog.NewMenu }) { Icon(Icons.Default.Add, "More ways to create") }
                    ExtendedFloatingActionButton(onClick = newNote, icon = { Icon(Icons.Default.Edit, null) }, text = { Text(if (type == "templates") "Template" else "Note") })
                }
            },
        ) { pad ->
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = {
                refreshing = true
                scope.launch {
                    runCatching { app.sync.run(ws) }.onFailure { Toast.makeText(app, "Sync failed: ${it.message}", Toast.LENGTH_SHORT).show() }
                    refreshing = false
                }
            }, modifier = Modifier.padding(pad).fillMaxSize()) {
                if (type == "home") HomeDashboard(app, s, onOpen = open, onList = { t, a -> go(if (t == "tasks") "tasks" else "list/$t/$a") }, onCreate = {
                    scope.launch { open(repo.createNote(useDefaultNotebook = false)) }
                }, quickActions = listOfNotNull(
                    "📝  New note" to newNote,
                    "📅  Daily note" to { scope.launch { open(repo.dailyNote()) }; Unit },
                    "📷  Scan" to startScan,
                    "▦  New database" to { scope.launch { open(repo.createNote(notebookId = null, useDefaultNotebook = false, kind = "db", dbSchema = DEFAULT_DB_SCHEMA)) }; Unit },
                    "🔎  Search" to { nav.navigate("search") },
                    if (s.ai) "✨  Ask AI" to { nav.navigate("ask") } else null,
                ), onCustomize = { customizing = true }, hidden = hiddenWidgets)
                else if (notes.isEmpty()) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Spacer(Modifier.height(80.dp))
                        Text(when {
                            sync == null && type == "all" -> "Syncing your notes…"
                            type == "trash" -> "Trash is empty"
                            type == "templates" -> "No templates yet"
                            else -> "Nothing here yet"
                        }, style = MaterialTheme.typography.titleMedium)
                        Text(if (type == "templates") "Tap Template to make one, or save a note as a template from its menu." else "Tap Note to write, or + for pages, databases and scans.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (currentNb != null) TextButton(onClick = { dialog = HomeDialog.NotebookActions(currentNb) }) { Text("Notebook options") }
                    }
                } else LazyColumn(contentPadding = PaddingValues(bottom = 170.dp)) {
                    items(notes, key = { it.id }) { n ->
                        NoteRow(n, notebooks.firstOrNull { it.id == n.notebookId }?.name.takeIf { type != "nb" }, selected = twoPane && selected.value == n.id,
                            onLongClick = { dialog = HomeDialog.NoteActions(n) }) {
                            if (type == "templates") scope.launch { repo.duplicate(n.id, asNewFromTemplate = true)?.let(open) } else open(n.id)
                        }
                    }
                }
            }
        }
    }

    // ---------- Layout: phone = one pane; unfolded = sidebar + list + note, split at the hinge when there is one ----------
    val shell: @Composable () -> Unit = {
        val sel = selected.value
        val showDetail = twoPane && (sel != null || type != "home")
        Row(
            Modifier.fillMaxSize().onPreviewKeyEvent { e ->
                // Hardware keyboard shortcuts (foldables are often used with one).
                if (e.type != KeyEventType.KeyDown || !e.isCtrlPressed) return@onPreviewKeyEvent false
                when (e.key) {
                    Key.N -> { newNote(); true }
                    Key.F, Key.K -> { nav.navigate("search"); true }
                    Key.D -> { scope.launch { open(repo.dailyNote()) }; true }
                    Key.W -> { selected.value = null; true }
                    else -> false
                }
            },
        ) {
            if (permanent) {
                Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.width(layout.sidebarWidth).fillMaxHeight()) {
                    Box(Modifier.statusBarsPadding()) { sidebar() }
                }
                VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            if (!showDetail) {
                Box(Modifier.weight(1f).fillMaxHeight()) { listPane() }
            } else {
                // Line the split up with the fold so neither pane sits in the crease.
                val left = if (permanent) layout.sidebarWidth + 1.dp else 0.dp
                val listWidth = layout.hingeDp?.let { (it - left).coerceIn(280.dp, 560.dp) } ?: ((layout.widthDp.dp - left) * 0.4f).coerceIn(300.dp, 440.dp)
                Box(Modifier.width(listWidth).fillMaxHeight()) { listPane() }
                if (layout.hingeDp == null) VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (sel != null) key(sel) {
                        NoteScreen(sel, app, s.ai, onBack = { selected.value = null }, openNote = { selected.value = it }, inPane = true)
                    } else EmptyPane(type)
                }
            }
        }
    }

    if (permanent) shell()
    else ModalNavigationDrawer(drawerState = drawer, drawerContent = { ModalDrawerSheet(Modifier.width(310.dp)) { sidebar() } }) { shell() }

    if (customizing) MultiPickDialog("Show or hide on Home", HomePrefs.WIDGETS, label = { it.second },
        sub = { if (it.first in hiddenWidgets) "Hidden · tap to show" else "Shown · tap to hide" }, ok = "Apply", onDismiss = { customizing = false }) { picked ->
        hiddenWidgets = hiddenWidgets.toMutableSet().apply { picked.forEach { (k, _) -> if (!add(k)) remove(k) } }
        HomePrefs.setHidden(ctx, hiddenWidgets)
    }

    // ---------- Dialogs and sheets ----------
    val toast: (String) -> Unit = { Toast.makeText(ctx, it, Toast.LENGTH_SHORT).show() }
    when (val d = dialog) {
        null -> {}
        is HomeDialog.NewMenu -> ActionSheet("Create", listOfNotNull(
            SheetAction("Note", Icons.Default.Edit) { scope.launch { open(repo.createNote(notebookId = currentNb?.id)) } },
            SheetAction("Page (outside notebooks)", Icons.Default.Description) { scope.launch { open(repo.createNote(useDefaultNotebook = false)) } },
            SheetAction("Database", Icons.Default.TableChart) { scope.launch { open(repo.createNote(title = "", notebookId = currentNb?.id, kind = "db", dbSchema = DEFAULT_DB_SCHEMA)) } },
            SheetAction("Today's daily note", Icons.Default.CalendarToday) { scope.launch { open(repo.dailyNote()) } },
            SheetAction("Scan a document", Icons.Default.DocumentScanner) { startScan() },
        ) + templates.map { t -> SheetAction("From template: ${t.title.ifBlank { "Untitled" }}", emoji = t.icon ?: "🧩") { scope.launch { repo.duplicate(t.id, asNewFromTemplate = true)?.let(open) } } }) { dialog = null }

        is HomeDialog.NotebookActions -> ActionSheet("${d.nb.icon ?: "📓"} ${d.nb.name}", listOfNotNull(
            SheetAction("New note here", Icons.Default.Add) { scope.launch { open(repo.createNote(notebookId = d.nb.id)) } },
            SheetAction("Rename", Icons.Default.Edit) { dialog = HomeDialog.RenameNotebook(d.nb) },
            SheetAction("Change icon", Icons.Default.EmojiEmotions) { dialog = HomeDialog.NotebookIcon(d.nb) },
            SheetAction(if (d.nb.stack == null) "Add to a stack" else "Move to another stack", Icons.Default.Folder) { dialog = HomeDialog.MoveToStack(d.nb) },
            d.nb.stack?.let { SheetAction("Remove from “$it”", Icons.Default.RemoveCircleOutline) { scope.launch { repo.setNotebookStack(d.nb.id, null); toast("Removed from $it") } } },
            SheetAction("Delete notebook", Icons.Default.Delete, danger = true) { dialog = HomeDialog.DeleteNotebook(d.nb) },
        )) { if (dialog == d) dialog = null }

        is HomeDialog.StackActions -> ActionSheet("📚 ${d.stack}", listOf(
            SheetAction("New notebook in this stack", Icons.Default.Add) { dialog = HomeDialog.NewNotebook(d.stack) },
            SheetAction("Add notebooks…", Icons.Default.LibraryAdd) { dialog = HomeDialog.AddToStack(d.stack) },
            SheetAction("Remove notebooks…", Icons.Default.RemoveCircleOutline) { dialog = HomeDialog.RemoveFromStack(d.stack) },
            SheetAction("Rename stack", Icons.Default.Edit) { dialog = HomeDialog.RenameStack(d.stack) },
            SheetAction("Ungroup stack", Icons.Default.FolderOpen, danger = true) { dialog = HomeDialog.UngroupStack(d.stack) },
        )) { if (dialog == d) dialog = null }

        is HomeDialog.TagActions -> ActionSheet("#${d.tag.name}", listOf(
            SheetAction("Rename tag", Icons.Default.Edit) { dialog = HomeDialog.RenameTag(d.tag) },
            SheetAction("Delete tag", Icons.Default.Delete, danger = true) { scope.launch { repo.deleteTag(d.tag.id); if (type == "tag") go("list/all/-") } },
        )) { if (dialog == d) dialog = null }

        is HomeDialog.NoteActions -> {
            val n = d.note
            ActionSheet(n.title.ifBlank { "Untitled" }, if (n.trashedAt != null) listOf(
                SheetAction("Restore", Icons.Default.Restore) { scope.launch { repo.restore(n.id); toast("Restored") } },
                SheetAction("Delete forever", Icons.Default.DeleteForever, danger = true) { scope.launch { repo.deleteForever(n.id) } },
            ) else listOf(
                SheetAction(if (n.pinned) "Remove from shortcuts" else "Add to shortcuts", if (n.pinned) Icons.Default.StarBorder else Icons.Default.Star) { scope.launch { repo.setPinned(n.id, !n.pinned) } },
                SheetAction("Move to notebook", Icons.AutoMirrored.Filled.DriveFileMove) { dialog = HomeDialog.MoveNote(n) },
                SheetAction("Duplicate", Icons.Default.ContentCopy) { scope.launch { repo.duplicate(n.id); toast("Duplicated") } },
                SheetAction(if (n.isTemplate) "Stop using as template" else "Save as template", Icons.AutoMirrored.Filled.ViewQuilt) { scope.launch { repo.setTemplate(n.id, !n.isTemplate) } },
                SheetAction("Move to trash", Icons.Default.Delete, danger = true) { scope.launch { repo.trash(n.id); toast("Moved to trash") } },
            )) { if (dialog == d) dialog = null }
        }

        is HomeDialog.MoveNote -> ActionSheet("Move to notebook", notebooks.map { nb ->
            SheetAction((if (nb.id == d.note.notebookId) "✓ " else "") + nb.name + (nb.stack?.let { "  ·  $it" } ?: ""), emoji = nb.icon ?: "📓") { scope.launch { repo.moveTo(d.note.id, nb.id); toast("Moved to ${nb.name}") } }
        } + SheetAction("No notebook (make it a page)", Icons.Default.Description) { scope.launch { repo.moveTo(d.note.id, null) } }) { if (dialog == d) dialog = null }

        is HomeDialog.MoveToStack -> ActionSheet("Move “${d.nb.name}” to stack", stackNames.filter { it != d.nb.stack }.map { st ->
            SheetAction(st, Icons.Default.Folder) { scope.launch { repo.setNotebookStack(d.nb.id, st); toast("Moved to $st") } }
        } + SheetAction("New stack…", Icons.Default.LibraryAdd) { dialog = HomeDialog.NewStackFor(d.nb) }) { if (dialog == d) dialog = null }

        is HomeDialog.NewStackFor -> PromptDialog("New stack", label = "Stack name", ok = if (d.nb != null) "Move" else "Next", onDismiss = { if (dialog == d) dialog = null }) { name ->
            if (d.nb != null) scope.launch { repo.setNotebookStack(d.nb.id, name); toast("Moved to $name") }
            else dialog = HomeDialog.AddToStack(name) // a stack needs notebooks: pick them next
        }

        is HomeDialog.NewNotebook -> PromptDialog(if (d.stack != null) "New notebook in ${d.stack}" else "New notebook", ok = "Create", onDismiss = { if (dialog == d) dialog = null }) { name ->
            scope.launch { val id = repo.createNotebook(name, d.stack); go("list/nb/$id") }
        }

        is HomeDialog.AddToStack -> MultiPickDialog("Add notebooks to “${d.stack}”", notebooks.filter { it.stack != d.stack }, label = { "${it.icon ?: "📓"} ${it.name}" },
            sub = { it.stack?.let { st -> "in $st" } }, ok = "Add", onDismiss = { if (dialog == d) dialog = null }) { picked ->
            scope.launch { picked.forEach { repo.setNotebookStack(it.id, d.stack) }; closedStacks.value = closedStacks.value - d.stack; toast("Added ${picked.size} to ${d.stack}") }
        }

        is HomeDialog.RemoveFromStack -> MultiPickDialog("Remove from “${d.stack}”", notebooks.filter { it.stack == d.stack }, label = { "${it.icon ?: "📓"} ${it.name}" },
            ok = "Remove", onDismiss = { if (dialog == d) dialog = null }) { picked -> scope.launch { picked.forEach { repo.setNotebookStack(it.id, null) } } }

        is HomeDialog.RenameStack -> PromptDialog("Rename stack", initial = d.stack, onDismiss = { if (dialog == d) dialog = null }) { name -> scope.launch { repo.renameStack(d.stack, name) } }

        is HomeDialog.UngroupStack -> ConfirmDialog("Ungroup “${d.stack}”?", "Its notebooks are kept and shown on their own.", ok = "Ungroup", onDismiss = { if (dialog == d) dialog = null }) {
            scope.launch { repo.ungroupStack(d.stack) }
        }

        is HomeDialog.RenameNotebook -> PromptDialog("Rename notebook", initial = d.nb.name, onDismiss = { if (dialog == d) dialog = null }) { name -> scope.launch { repo.renameNotebook(d.nb.id, name) } }

        is HomeDialog.NotebookIcon -> EmojiDialog(onDismiss = { if (dialog == d) dialog = null }) { e -> scope.launch { repo.setNotebookIcon(d.nb.id, e) } }

        is HomeDialog.DeleteNotebook -> ConfirmDialog("Delete “${d.nb.name}”?", "The notebook is deleted and its notes go to the trash, where you can restore them for 30 days.",
            ok = "Delete", danger = true, onDismiss = { if (dialog == d) dialog = null }) { scope.launch { repo.deleteNotebook(d.nb.id); go("list/all/-") } }

        is HomeDialog.RenameTag -> PromptDialog("Rename tag", initial = d.tag.name, onDismiss = { if (dialog == d) dialog = null }) { name -> scope.launch { repo.renameTag(d.tag.id, name) } }

        is HomeDialog.EmptyTrash -> ConfirmDialog("Empty trash?", "Everything in the trash is deleted for good.", ok = "Empty trash", danger = true, onDismiss = { if (dialog == d) dialog = null }) {
            scope.launch { repo.emptyTrash() }
        }
    }
}

/** Right-hand pane on unfolded screens before a note is chosen. */
@Composable
private fun EmptyPane(type: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (type == "trash") "🗑️" else "🗒️", fontSize = 48.sp)
        Text("Select a note", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
        Text("It opens here, beside the list. Ctrl+N makes a new one.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
    }
}

const val DEFAULT_DB_SCHEMA = """{"props":[{"id":"status","name":"Status","type":"status","options":[{"id":"todo","name":"Not started","color":"gray"},{"id":"doing","name":"In progress","color":"blue"},{"id":"done","name":"Done","color":"green"}]},{"id":"date","name":"Date","type":"date"},{"id":"owner","name":"Owner","type":"person"}],"views":[{"id":"v1","name":"Table","type":"table"},{"id":"v2","name":"Board","type":"board","group":"status"},{"id":"v3","name":"Calendar","type":"calendar","date":"date"}]}"""

/** A page in the drawer's page tree, with its sub-pages one level deeper. */
@Composable
private fun PageTreeRow(app: PliopadApp, p: NoteEntity, depth: Int, open: androidx.compose.runtime.MutableState<Set<String>>, onOpen: (String) -> Unit) {
    val children by app.dao.children(p.id).collectAsState(initial = emptyList())
    val kids = if (p.kind == "db") emptyList() else children
    val isOpen = p.id in open.value
    DrawerRow(p.title.ifBlank { "Untitled" }, { Text(p.icon ?: if (p.kind == "db") "▦" else "📄") }, indent = depth,
        trailing = if (kids.isNotEmpty()) ({
            IconButton(onClick = { open.value = if (isOpen) open.value - p.id else open.value + p.id }, modifier = Modifier.size(32.dp)) {
                Icon(if (isOpen) Icons.Default.ExpandMore else Icons.Default.ChevronRight, if (isOpen) "Collapse" else "Expand", Modifier.size(18.dp))
            }
        }) else null) { onOpen(p.id) }
    if (isOpen) kids.forEach { PageTreeRow(app, it, depth + 1, open, onOpen) }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NoteRow(n: NoteEntity, sub: String?, selected: Boolean = false, onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = .55f) else Color.Transparent)
        .combinedClickable(onClick = onClick, onLongClick = onLongClick).padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (n.pinned) Text("★ ", color = MaterialTheme.colorScheme.primary)
            Text((n.icon?.plus(" ") ?: "") + n.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (n.dirty) Icon(Icons.Default.CloudUpload, "Not synced yet", Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val snippet = if (n.kind == "db") "Database" else n.plain.replace('\n', ' ')
        if (snippet.isNotBlank()) Text(snippet, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        Text(listOfNotNull(relative(n.updatedAt), sub, n.reminderAt?.let { "⏰ " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it)) }).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .8f), modifier = Modifier.padding(top = 4.dp))
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

fun relative(ms: Long): String {
    val d = (System.currentTimeMillis() - ms) / 1000
    return when {
        d < 60 -> "just now"; d < 3600 -> "${d / 60} min ago"; d < 86400 -> "${d / 3600} h ago"; d < 6 * 86400 -> "${d / 86400} d ago"
        else -> DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(ms))
    }
}

// ---------- Search: instant local results, plus the server's full search (operators, OCR text) when online ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(app: PliopadApp, s: SessionData, nav: NavHostController) {
    val ws = s.workspace?.id ?: 0
    var q by rememberSaveable { mutableStateOf("") }
    var local by remember { mutableStateOf<List<NoteEntity>>(emptyList()) }
    var remote by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    LaunchedEffect(q) {
        local = if (q.isBlank()) emptyList() else app.dao.search(ws, q.trim().split(' ').filterNot { ':' in it || it.startsWith('-') }.joinToString(" ").ifBlank { q.trim() })
        remote = emptyList()
        if (q.trim().length >= 2) {
            kotlinx.coroutines.delay(300)
            remote = runCatching { app.api.search(ws, q.trim()).map { it.id to it.title } }.getOrDefault(emptyList())
        }
    }
    val extra = remote.filter { (id, _) -> local.none { it.id == id } }
    Scaffold(topBar = {
        TopAppBar(navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            title = { OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth().padding(end = 8.dp), placeholder = { Text("Search notes, scans, tag:work, is:todo…") }, singleLine = true) })
    }) { pad ->
        LazyColumn(Modifier.padding(pad)) {
            items(local, key = { it.id }) { n ->
                Column(Modifier.fillMaxWidth().clickable { nav.navigate("note/${n.id}") }.padding(16.dp)) {
                    Text(n.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold)
                    val i = n.plain.indexOf(q, ignoreCase = true)
                    val hit = if (i >= 0) "…" + n.plain.substring((i - 40).coerceAtLeast(0), (i + 100).coerceAtMost(n.plain.length)).replace('\n', ' ') + "…" else n.plain.take(120)
                    Text(hit, maxLines = 2, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
                }
                HorizontalDivider()
            }
            if (extra.isNotEmpty()) item { Text("More matches on the server", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(16.dp)) }
            items(extra, key = { "r" + it.first }) { (id, title) ->
                Text(title.ifBlank { "Untitled" }, Modifier.fillMaxWidth().clickable { nav.navigate("note/$id") }.padding(16.dp), fontWeight = FontWeight.SemiBold)
                HorizontalDivider()
            }
            if (q.isNotBlank() && local.isEmpty() && extra.isEmpty()) item { Text("No matches.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

// ---------- Ask AI ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AskScreen(app: PliopadApp, s: SessionData, nav: NavHostController) {
    val scope = rememberCoroutineScope()
    var q by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<app.pliopad.data.AskResult?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    Scaffold(topBar = { TopAppBar(title = { Text("✨ Ask your notes") }, navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) }) { pad ->
        Column(Modifier.padding(pad).padding(16.dp).verticalScroll(rememberScrollState())) {
            Text("Answers come only from your workspace, with links to the notes they used.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth().padding(top = 12.dp), placeholder = { Text("What did we decide about pricing?") }, minLines = 2)
            Button(enabled = q.isNotBlank() && !busy, modifier = Modifier.padding(top = 8.dp), onClick = {
                busy = true; error = null
                scope.launch {
                    runCatching { app.api.ask(s.workspace?.id ?: 0, q.trim()) }.onSuccess { result = it }.onFailure { error = "Ask AI needs a connection: ${it.message}" }
                    busy = false
                }
            }) { Text(if (busy) "Reading your notes…" else "Ask") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
            result?.let { r ->
                Text(r.answer, modifier = Modifier.padding(top = 16.dp))
                if (r.sources.isNotEmpty()) {
                    Text("Sources", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
                    r.sources.forEach { src -> Text("[${src.n}]  ${src.title}", Modifier.fillMaxWidth().clickable { nav.navigate("note/${src.id}") }.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.primary) }
                }
            }
        }
    }
}
