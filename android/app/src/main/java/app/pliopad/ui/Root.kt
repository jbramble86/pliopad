package app.pliopad.ui

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Color
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
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
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.pliopad.BuildConfig
import app.pliopad.PliopadApp
import app.pliopad.R
import app.pliopad.Launch
import app.pliopad.MainActivity
import app.pliopad.core.Block
import app.pliopad.core.Blocks
import app.pliopad.data.ApiException
import app.pliopad.work.Maintenance
import app.pliopad.data.NoteEntity
import app.pliopad.data.SessionData
import app.pliopad.scan.Scanner
import app.pliopad.work.SyncWorker
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.time.LocalDate
import java.util.Date

@Composable
fun PliopadRoot(activity: MainActivity) {
    val app = activity.application as PliopadApp
    val session by app.session.data.collectAsState(initial = null)
    val locked by activity.locked.collectAsState()
    val s = session ?: return
    when {
        !s.signedIn -> SignInScreen(app, s)
        locked -> LockScreen { activity.unlock() }
        else -> MainNav(activity, app, s)
    }
}

@Composable
private fun LockScreen(unlock: () -> Unit) {
    LaunchedEffect(Unit) { unlock() }
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Default.Lock, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(16.dp))
        Text("PlioPad is locked", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(16.dp))
        Button(onClick = unlock) { Text("Unlock") }
    }
}

// ---------- Sign in ----------

@Composable
private fun SignInScreen(app: PliopadApp, s: SessionData) {
    val scope = rememberCoroutineScope()
    var signUp by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var needCode by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.Center) {
        Spacer(Modifier.height(48.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.brand_mark), null, Modifier.size(44.dp))
            Spacer(Modifier.width(6.dp))
            // The wordmark: "Plio" in navy (or white in dark mode), "Pad" in periwinkle.
            Text(androidx.compose.ui.text.buildAnnotatedString {
                append("Plio")
                pushStyle(androidx.compose.ui.text.SpanStyle(color = MaterialTheme.colorScheme.primary)); append("Pad"); pop()
            }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold,
                color = if (isSystemInDarkTheme()) Color.White else Navy)
        }
        Text("Notes, docs and databases. Works offline.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(24.dp))
        if (signUp) OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Your name") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Words))
        OutlinedTextField(email, { email = it.trim() }, Modifier.fillMaxWidth(), label = { Text("Email") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text(if (signUp) "Password (at least 10 characters)" else "Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        if (needCode && !signUp) OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, Modifier.fillMaxWidth(), label = { Text("Authentication code") },
            singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        Spacer(Modifier.height(16.dp))
        Button(enabled = !busy && email.isNotBlank() && password.isNotBlank() && (!signUp || (name.isNotBlank() && password.length >= 10)), modifier = Modifier.fillMaxWidth().height(48.dp), onClick = {
            busy = true; error = null
            scope.launch {
                try {
                    val r = if (signUp) app.api.signup(app.serverUrl, name.trim(), email, password)
                        else app.api.login(app.serverUrl, email, password, code.ifBlank { null })
                    app.session.signIn(app.serverUrl, r.token!!, r.user, r.workspaces, r.ai)
                    SyncWorker.schedulePeriodic(app)
                    SyncWorker.requestSoon(app, 0)
                } catch (e: ApiException) {
                    if (e.code == "mfa") needCode = true
                    error = e.message
                } catch (e: Exception) {
                    error = "Could not reach PlioPad. Check your internet connection."
                } finally { busy = false }
            }
        }) { Text(when { busy && signUp -> "Creating your account…"; busy -> "Signing in…"; signUp -> "Create account"; else -> "Sign in" }) }
        TextButton(onClick = { signUp = !signUp; error = null; needCode = false }, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp)) {
            Text(if (signUp) "Already have an account? Sign in" else "New to PlioPad? Create an account")
        }
    }
}

// ---------- Navigation ----------

@Composable
private fun MainNav(activity: MainActivity, app: PliopadApp, s: SessionData) {
    val nav = rememberNavController()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val launch by activity.launches.collectAsState()
    val notify = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) { if (Build.VERSION.SDK_INT >= 33) notify.launch(Manifest.permission.POST_NOTIFICATIONS) }
    // The note open beside the list on unfolded screens (kept here so widget and notification launches can use it).
    val selected = rememberSaveable { mutableStateOf<String?>(null) }
    val twoPane = LocalLayout.current.twoPane
    val openNote: (String) -> Unit = { id -> if (twoPane) { nav.popBackStack("list/{type}/{arg}", inclusive = false); selected.value = id } else nav.navigate("note/$id") }
    val scanLauncher = Scanner.rememberScanLauncher { pages ->
        scope.launch {
            val text = pages.map { Scanner.recognize(ctx, it) }.joinToString("\n\n")
            val id = app.repo.createNote(title = "Scan " + DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date()),
                blocks = Scanner.blocksFor(pages.map { app.repo.importImage(it) }, text))
            openNote(id)
        }
    }
    // Voice note: Android speech-to-text, saved as a new note in the Inbox.
    val voiceLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val text = res.data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
        if (res.resultCode == android.app.Activity.RESULT_OK && !text.isNullOrBlank()) scope.launch {
            val title = text.split(" ").take(8).joinToString(" ").let { if (text.length > it.length) "$it…" else it }
            openNote(app.repo.createNote(title = "🎙️ " + title, blocks = listOf(Block(t = "p", x = text))))
        }
    }
    val startScan: () -> Unit = { scope.launch { runCatching { Scanner.start(activity) { scanLauncher.launch(it) } }.onFailure { Toast.makeText(ctx, "The document scanner is not available on this device.", Toast.LENGTH_LONG).show() } } }
    LaunchedEffect(launch) {
        when (val l = launch) {
            is Launch.OpenNote -> openNote(l.id)
            Launch.NewNote -> openNote(app.repo.createNote())
            Launch.Scan -> startScan()
            Launch.Voice -> runCatching { voiceLauncher.launch(voiceIntent()) }.onFailure { Toast.makeText(ctx, "Speech recognition is not available on this device.", Toast.LENGTH_LONG).show() }
            Launch.Daily -> openNote(app.repo.dailyNote())
            Launch.Search -> nav.navigate("search")
            Launch.Tasks -> nav.navigate("tasks")
            Launch.Graph -> nav.navigate("graph")
            null -> {}
        }
        activity.launches.value = null
    }
    // Fold/unfold continuity: a full-screen note moves into the side pane when the phone opens, and back out when it closes.
    // Notes opened from Search or Ask AI on an unfolded screen land in the pane too.
    val entry by nav.currentBackStackEntryAsState()
    LaunchedEffect(twoPane, entry) {
        val route = entry?.destination?.route
        if (twoPane && route == "note/{id}") {
            val id = entry?.arguments?.getString("id")
            nav.popBackStack("list/{type}/{arg}", inclusive = false)
            selected.value = id
        } else if (!twoPane && selected.value != null && route == "list/{type}/{arg}") {
            val id = selected.value!!
            selected.value = null
            nav.navigate("note/$id")
        }
    }
    // Floating pill bar on phones and folded screens; unfolded screens keep the permanent sidebar instead.
    val pill = remember { PillState() }
    val route = entry?.destination?.route
    val listType = if (route == "list/{type}/{arg}") entry?.arguments?.getString("type") else null
    LaunchedEffect(route, listType) { pill.scrolledAway = false }
    val goTop: (String) -> Unit = { r ->
        nav.navigate(r) { popUpTo(nav.graph.findStartDestination().id) { inclusive = r == "list/home/-" }; launchSingleTop = true }
    }
    Box(Modifier.fillMaxSize().nestedScroll(pill.scroll)) {
    CompositionLocalProvider(LocalPill provides (if (twoPane) null else pill)) {
    // Short, simple transitions: the default cross-fade felt sluggish.
    NavHost(nav, startDestination = "list/home/-",
        enterTransition = { fadeIn(tween(160)) + slideInHorizontally(tween(200)) { it / 12 } },
        exitTransition = { fadeOut(tween(120)) },
        popEnterTransition = { fadeIn(tween(160)) },
        popExitTransition = { fadeOut(tween(120)) + slideOutHorizontally(tween(200)) { it / 12 } },
    ) {
        composable("list/{type}/{arg}") { e ->
            HomeScreen(app, s, nav, e.arguments?.getString("type") ?: "home", e.arguments?.getString("arg") ?: "-", startScan, selected)
        }
        composable("note/{id}") { e ->
            NoteScreen(e.arguments!!.getString("id")!!, app, s.ai, onBack = { nav.popBackStack() }, openNote = { nav.navigate("note/$it") })
        }
        composable("search") { SearchScreen(app, s, nav) }
        composable("ask") { AskScreen(app, s, nav) }
        composable("tasks") { TasksScreen(app, s, nav) }
        composable("graph") { GraphScreen(app, s, nav) { id -> nav.navigate("note/$id") } }
        composable("settings") { SettingsScreen(app, s, activity) { nav.popBackStack() } }
    }
    }
    PillNav(
        visible = !twoPane && (route == "list/{type}/{arg}" || route == "tasks") && !pill.scrolledAway && !pill.drawerOpen,
        current = when { route == "tasks" -> PillTab.Tasks; listType == "home" -> PillTab.Home; listType != null -> PillTab.Notes; else -> PillTab.None },
        onHome = { goTop("list/home/-") },
        onNotes = { goTop("list/all/-") },
        onNew = { pill.onNew?.invoke() ?: scope.launch { openNote(app.repo.createNote()) } },
        onNewMenu = pill.onNewMenu,
        onTasks = { goTop("tasks") },
        onSearch = { nav.navigate("search") },
        modifier = Modifier.align(Alignment.BottomCenter),
    )
    val maintenance by Maintenance.notice.collectAsState()
    maintenance?.let { MaintenanceBanner(it, Modifier.align(Alignment.TopCenter)) }
    }
}

/** Shown while PlioPad is down for maintenance. Edits keep saving on the phone and sync when it is back. */
@Composable
private fun MaintenanceBanner(message: String, modifier: Modifier = Modifier) {
    Surface(modifier.statusBarsPadding().padding(top = 8.dp, start = 16.dp, end = 16.dp), shape = RoundedCornerShape(16.dp),
        color = Color(0xFF101D59), contentColor = Color.White, shadowElevation = 6.dp) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
            Text("PlioPad is down for maintenance", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
            Text(if (message.startsWith("PlioPad is down for maintenance")) "Your edits are saved on this phone and sync when it is back." else message + " Your edits are saved on this phone.",
                style = MaterialTheme.typography.bodySmall, color = Color(0xFFC9CFEA))
        }
    }
}

private fun voiceIntent() = android.content.Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Speak your note")

// ---------- Tasks ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TasksScreen(app: PliopadApp, s: SessionData, nav: NavHostController) {
    val scope = rememberCoroutineScope()
    val ws = s.workspace?.id ?: 0
    val tasks by remember(ws) { app.dao.notesWithTodos(ws).map { list -> list.flatMap { Blocks.openTasks(it.id, it.title, Blocks.parse(it.content)) } } }.collectAsState(initial = emptyList())
    val today = LocalDate.now().toString()
    val groups = listOf(
        "Overdue" to tasks.filter { it.due != null && it.due < today }, "Today" to tasks.filter { it.due == today },
        "Upcoming" to tasks.filter { it.due != null && it.due > today }.sortedBy { it.due }, "No date" to tasks.filter { it.due == null },
    ).filter { it.second.isNotEmpty() }
    Scaffold(topBar = { TopAppBar(title = { Text("Tasks") }, navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) }) { pad ->
        LazyColumn(Modifier.padding(pad), contentPadding = PaddingValues(bottom = if (LocalPill.current != null) PillClearance else 80.dp)) {
            if (groups.isEmpty()) item { Text("No open to-dos. Nice work. 🎉", Modifier.padding(24.dp)) }
            groups.forEach { (label, items) ->
                item(key = label) { Text("$label  ${items.size}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp)) }
                items(items, key = { it.noteId + it.blockId }) { t ->
                    Row(Modifier.fillMaxWidth().clickable { nav.navigate("note/${t.noteId}") }.padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = false, onCheckedChange = { scope.launch { app.repo.toggleTask(t.noteId, t.blockId) } })
                        Column(Modifier.weight(1f)) {
                            Text(t.text)
                            Text("📄 " + t.noteTitle.ifBlank { "Untitled" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

// ---------- Settings ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScreen(app: PliopadApp, s: SessionData, activity: MainActivity, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val ws = s.workspace?.id ?: 0
    val sync by app.dao.syncStateFlow(ws).collectAsState(initial = null)
    val pending by app.dao.pendingCount(ws).collectAsState(initial = 0)
    var busy by remember { mutableStateOf(false) }
    Scaffold(topBar = { TopAppBar(title = { Text("Settings") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) }) { pad ->
        Column(Modifier.padding(pad).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(Modifier.padding(16.dp)) {
                    Text(s.user?.name ?: "", fontWeight = FontWeight.SemiBold)
                    Text(s.user?.email ?: "", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("${s.workspace?.name} · ${s.workspace?.plan} plan · ${s.workspace?.role}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                }
            }
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Sync", fontWeight = FontWeight.SemiBold)
                    Text(sync?.lastSync?.takeIf { it > 0 }?.let { "Last synced ${relative(it)}" } ?: "Not synced yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(if (pending == 0) "Everything is up to date." else "$pending change${if (pending == 1) "" else "s"} waiting to upload.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(enabled = !busy, onClick = {
                        busy = true
                        scope.launch {
                            runCatching {
                                val me = app.api.me()
                                app.session.updateWorkspaces(me.workspaces, me.ai)
                                app.sync.run(ws)
                            }.onFailure { Toast.makeText(ctx, "Sync failed: ${it.message}", Toast.LENGTH_LONG).show() }
                            busy = false
                        }
                    }, modifier = Modifier.padding(top = 8.dp)) { Text(if (busy) "Syncing…" else "Sync now") }
                }
            }
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("App lock", fontWeight = FontWeight.SemiBold)
                        Text("Ask for your fingerprint, face or PIN when opening PlioPad.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
                    }
                    Switch(checked = s.appLock, onCheckedChange = { on -> scope.launch { app.session.setAppLock(on) } })
                }
            }
            TextButton(onClick = { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SERVER_URL + "/app/"))) }) { Text("Open PlioPad on the web") }
            TextButton(onClick = {
                scope.launch {
                    if (pending > 0) runCatching { app.sync.run(ws) } // try to upload unsaved changes first
                    app.api.logout()
                    app.session.signOut()
                    // Remove this account's notes from the phone.
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { app.database.clearAllTables() }
                    activity.locked.value = false
                }
            }) { Text("Sign out", color = MaterialTheme.colorScheme.error) }
            Text("PlioPad ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
