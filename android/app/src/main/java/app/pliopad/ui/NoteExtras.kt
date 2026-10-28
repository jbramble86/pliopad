package app.pliopad.ui

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.pliopad.PliopadApp
import app.pliopad.core.Blocks
import app.pliopad.data.Api
import app.pliopad.data.Comment
import app.pliopad.data.NoteEntity
import app.pliopad.data.Version
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/** Pick a page to link to (opened by typing "[[" or Insert → Link to a page). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PagePicker(app: PliopadApp, ws: Long, exclude: String, onDismiss: () -> Unit, onCreate: (String) -> Unit, onPick: (NoteEntity) -> Unit) {
    var q by remember { mutableStateOf("") }
    val all by app.dao.allForPicker(ws).collectAsState(initial = emptyList())
    val matches = all.filter { it.id != exclude && it.title.contains(q.trim(), ignoreCase = true) }.sortedByDescending { it.updatedAt }.take(30)
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.navigationBarsPadding().imePadding().padding(horizontal = 16.dp)) {
            Text("Link to page", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth().padding(vertical = 8.dp), placeholder = { Text("Search pages") }, singleLine = true)
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                items(matches, key = { it.id }) { p ->
                    Text("${p.icon ?: "📄"}  ${p.title.ifBlank { "Untitled" }}", Modifier.fillMaxWidth().clickable { onDismiss(); onPick(p) }.padding(vertical = 12.dp))
                }
                if (q.isNotBlank()) item {
                    Text("+  Create page “${q.trim()}”", Modifier.fillMaxWidth().clickable { onDismiss(); onCreate(q.trim()) }.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}

/** Comments live on the server, so they need a connection. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommentsSheet(app: PliopadApp, ws: Long, noteId: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var comments by remember { mutableStateOf<List<Comment>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    suspend fun load() { runCatching { app.api.comments(ws, noteId) }.onSuccess { comments = it; error = null }.onFailure { error = "Comments need a connection." } }
    LaunchedEffect(noteId) { app.runCatching { sync.run(ws) }; load() }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.navigationBarsPadding().imePadding().padding(horizontal = 16.dp)) {
            Text("Comments", style = MaterialTheme.typography.titleMedium)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp)) }
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                val list = comments.orEmpty()
                if (comments != null && list.isEmpty()) item { Text("No comments yet.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 12.dp)) }
                items(list, key = { it.id }) { c ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(c.user_name, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Text(relative(c.created_at), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(onClick = { scope.launch { runCatching { app.api.resolveComment(ws, c.id, c.resolved == 0) }; load() } }) { Text(if (c.resolved == 0) "Resolve" else "Reopen") }
                        }
                        Text(c.body, color = if (c.resolved == 0) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider()
                }
            }
            OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth().padding(top = 8.dp), placeholder = { Text("Add a comment… use @Name to notify someone") }, minLines = 2)
            Button(enabled = text.isNotBlank(), modifier = Modifier.padding(vertical = 8.dp), onClick = {
                val body = text.trim()
                scope.launch { runCatching { app.api.addComment(ws, noteId, body) }.onSuccess { text = ""; load() }.onFailure { error = "Could not post: ${it.message}" } }
            }) { Text("Comment") }
        }
    }
}

/** Earlier versions from the server; restoring one replaces the page content (the current text is kept as a version too). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistorySheet(app: PliopadApp, ws: Long, noteId: String, readOnly: Boolean, onClose: (NoteEntity?) -> Unit) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var versions by remember { mutableStateOf<List<Version>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var preview by remember { mutableStateOf<Pair<Version, String>?>(null) }
    LaunchedEffect(noteId) {
        app.runCatching { sync.run(ws) }
        runCatching { app.api.versions(ws, noteId) }.onSuccess { versions = it }.onFailure { error = "Version history needs a connection." }
    }
    ModalBottomSheet(onDismissRequest = { onClose(null) }) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 16.dp)) {
            Text("Version history", style = MaterialTheme.typography.titleMedium)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp)) }
            if (versions?.isEmpty() == true) Text("No earlier versions yet. Versions are saved as you edit.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 12.dp))
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(versions.orEmpty(), key = { it.id }) { v ->
                    Column(Modifier.fillMaxWidth().clickable {
                        scope.launch { runCatching { app.api.version(ws, v.id) }.onSuccess { preview = v to Blocks.plain(it.content) } }
                    }.padding(vertical = 10.dp)) {
                        Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(v.created_at)))
                        Text(v.user_name ?: "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider()
                }
            }
        }
    }
    preview?.let { (v, text) ->
        AlertDialog(onDismissRequest = { preview = null }, title = { Text(v.title.ifBlank { "Untitled" }) },
            text = { LazyColumn(Modifier.heightIn(max = 360.dp)) { item { Text(text.ifBlank { "(empty)" }) } } },
            confirmButton = {
                if (!readOnly) TextButton(onClick = {
                    scope.launch {
                        runCatching { app.api.restoreVersion(ws, v.id) }.onSuccess { s ->
                            val local = Api.fromServer(ws, s)
                            app.dao.upsertNote(local)
                            preview = null
                            Toast.makeText(ctx, "Version restored", Toast.LENGTH_SHORT).show()
                            onClose(local)
                        }.onFailure { Toast.makeText(ctx, "Could not restore: ${it.message}", Toast.LENGTH_LONG).show() }
                    }
                }) { Text("Restore this version") }
            },
            dismissButton = { TextButton(onClick = { preview = null }) { Text("Close") } })
    }
}

/** Publish a read-only copy of the page on the web. */
@Composable
fun PublishDialog(app: PliopadApp, ws: Long, n: NoteEntity, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var url by remember { mutableStateOf<String?>(n.shareSlug?.let { "${app.api.serverBase()}/s/$it" }) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun set(enabled: Boolean) {
        busy = true
        scope.launch {
            runCatching { app.sync.run(ws); app.api.share(ws, n.id, enabled) }
                .onSuccess { r -> url = r.share_url; app.dao.upsertNote(n.copy(shareSlug = r.share_slug)); error = null }
                .onFailure { error = "Publishing needs a connection: ${it.message}" }
            busy = false
        }
    }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Publish to the web") },
        text = {
            Column {
                Text(if (url != null) "Anyone with the link can view this page." else "Create a read-only public link, for docs, a roadmap or a team wiki.")
                url?.let { u ->
                    Text(u, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 10.dp).clickable { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } })
                    Row(Modifier.padding(top = 8.dp)) {
                        OutlinedButton(onClick = { ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, u), "Share link")) }) { Text("Share link") }
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = { set(url == null) }) { Text(if (url == null) "Publish" else "Unpublish") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } })
}
