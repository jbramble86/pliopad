package app.pliopad.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Article
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.pliopad.BuildConfig
import app.pliopad.PliopadApp
import app.pliopad.data.HelpData
import app.pliopad.data.Ticket
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/** Screenshots and files picked for a message, uploaded as soon as they're chosen (up to 5). */
private class Attachments {
    val files = androidx.compose.runtime.mutableStateListOf<app.pliopad.data.SupportFile>()
    var uploading by mutableStateOf(0)
    fun ids() = files.map { it.id }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AttachRow(app: PliopadApp, att: Attachments, onError: (String) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val pick = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia(5)) { uris ->
        uris.take(5 - att.files.size).forEach { uri ->
            att.uploading++
            scope.launch {
                runCatching {
                    val mime = ctx.contentResolver.getType(uri) ?: "image/jpeg"
                    val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { ctx.contentResolver.openInputStream(uri)!!.use { it.readBytes() } }
                    app.api.uploadSupportFile("screenshot." + (mime.substringAfter('/').takeIf { it.length in 3..4 } ?: "jpg"), mime, bytes)
                }.onSuccess { att.files += it }.onFailure { onError(it.message ?: "Upload failed") }
                att.uploading--
            }
        }
    }
    FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedButton(onClick = { pick.launch(androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            enabled = att.files.size < 5) {
            Icon(Icons.Default.AttachFile, null, Modifier.size(18.dp)); Text("Add screenshots", Modifier.padding(start = 6.dp))
        }
        att.files.forEach { f ->
            androidx.compose.material3.InputChip(selected = false, onClick = { att.files.remove(f) }, label = { Text(f.name) },
                trailingIcon = { Icon(Icons.Default.Close, "Remove", Modifier.size(16.dp)) })
        }
        if (att.uploading > 0) Text("Uploading…", Modifier.align(Alignment.CenterVertically), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Where the Help center is: its front page, an article, the contact form, or one of your requests. */
private sealed interface HelpPage {
    data object Front : HelpPage
    data class Article(val id: String) : HelpPage
    /** Contact support, optionally from a help article (it's attached to the request). */
    data class Contact(val articleId: String? = null) : HelpPage
    data class Request(val id: Long) : HelpPage
}

private val KINDS = listOf("question" to "A question", "problem" to "Something isn't working", "billing" to "Billing or my plan", "idea" to "A feature idea")
private val STATUS = mapOf("open" to "Waiting for support", "answered" to "Support replied", "on_hold" to "On hold", "closed" to "Solved")

/**
 * Help center: the same articles as the web and Windows (from the server), "Contact support", and your requests,
 * which platform admins answer from the admin console. Online only; offline it says so.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpScreen(app: PliopadApp, ws: Long?, onBack: () -> Unit) {
    var page by remember { mutableStateOf<HelpPage>(HelpPage.Front) }
    var help by remember { mutableStateOf<HelpData?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { app.api.help() }.onSuccess { help = it }.onFailure { error = "The Help center needs an internet connection." } }
    BackHandler(page != HelpPage.Front) { page = HelpPage.Front }
    val title = when (val p = page) {
        HelpPage.Front -> "Help center"
        is HelpPage.Article -> help?.articles?.firstOrNull { it.id == p.id }?.title ?: "Help"
        is HelpPage.Contact -> "Contact support"
        is HelpPage.Request -> "Request #${p.id}"
    }
    Scaffold(topBar = {
        TopAppBar(title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = { IconButton(onClick = { if (page == HelpPage.Front) onBack() else page = HelpPage.Front }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } })
    }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize().imePadding(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
                val data = help
                when {
                    error != null && data == null -> Text(error!!, Modifier.padding(top = 32.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    data == null -> Text("Loading…", Modifier.padding(top = 32.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else -> when (val p = page) {
                        HelpPage.Front -> HelpFront(app, data, open = { page = it })
                        is HelpPage.Article -> HelpArticleView(app, data, p.id, open = { page = it })
                        is HelpPage.Contact -> ContactForm(app, ws, data, p.articleId) { page = HelpPage.Request(it) }
                        is HelpPage.Request -> RequestView(app, p.id)
                    }
                }
                Spacer(Modifier.heightIn(min = 40.dp))
            }
        }
    }
}

@Composable
private fun HelpFront(app: PliopadApp, data: HelpData, open: (HelpPage) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var q by remember { mutableStateOf("") }
    var requests by remember { mutableStateOf<List<Ticket>?>(null) }
    LaunchedEffect(Unit) { requests = runCatching { app.api.tickets() }.getOrDefault(emptyList()) }
    Text("How can we help?", fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp, bottom = 12.dp))
    OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth(), placeholder = { Text("Search help articles") }, singleLine = true,
        leadingIcon = { Icon(Icons.Default.Search, null) }, shape = RoundedCornerShape(24.dp))
    if (q.isNotBlank()) {
        val hits = data.articles.filter { (it.title + " " + it.body).contains(q.trim(), ignoreCase = true) }
        if (hits.isEmpty()) Text("No articles match. Ask us instead.", Modifier.padding(vertical = 12.dp), color = cs.onSurfaceVariant)
        hits.forEach { ArticleRow(it.title) { open(HelpPage.Article(it.id)) } }
    } else data.categories.forEach { c ->
        Surface(shape = RoundedCornerShape(14.dp), color = cs.surfaceVariant.copy(alpha = .35f), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(30.dp).background(cs.primaryContainer, RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) { Text(c.icon) }
                    Text(c.name, Modifier.padding(start = 10.dp), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                }
                data.articles.filter { it.category == c.id }.forEach { ArticleRow(it.title) { open(HelpPage.Article(it.id)) } }
            }
        }
    }
    ContactCard("Still need help?", "Send us a message. We reply by email and here, on every device.") { open(HelpPage.Contact()) }
    Text("Your requests", Modifier.padding(top = 18.dp, bottom = 6.dp), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    when {
        requests == null -> Text("Loading…", color = cs.onSurfaceVariant)
        requests!!.isEmpty() -> Text("You haven't contacted support yet.", color = cs.onSurfaceVariant)
        else -> requests!!.forEach { t ->
            Surface(onClick = { open(HelpPage.Request(t.id)) }, shape = RoundedCornerShape(12.dp), color = cs.surface,
                border = androidx.compose.foundation.BorderStroke(1.dp, if (t.unread) cs.primary else cs.outlineVariant), modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(t.subject, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("#${t.id} · ${STATUS[t.status] ?: t.status}", fontSize = 12.sp, color = cs.onSurfaceVariant)
                    }
                    if (t.unread) Text("New reply", Modifier.background(cs.primary, RoundedCornerShape(10.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
                        color = cs.onPrimary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun ArticleRow(title: String, onClick: () -> Unit) =
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 44.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.AutoMirrored.Filled.Article, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, Modifier.padding(start = 10.dp), fontSize = 15.sp)
    }

@Composable
private fun ContactCard(title: String, sub: String, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(14.dp), color = cs.primaryContainer.copy(alpha = .6f), modifier = Modifier.fillMaxWidth().padding(top = 18.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(sub, Modifier.padding(top = 2.dp, bottom = 10.dp), fontSize = 13.sp, color = cs.onSurfaceVariant)
            Button(onClick = onClick) { Icon(Icons.Default.SupportAgent, null, Modifier.size(18.dp)); Text("Contact support", Modifier.padding(start = 8.dp)) }
        }
    }
}

/** Article bodies: paragraphs separated by blank lines; "- " and "1. " lines become lists. */
@Composable
private fun HelpArticleView(app: PliopadApp, data: HelpData, id: String, open: (HelpPage) -> Unit) {
    val a = data.articles.firstOrNull { it.id == id } ?: return
    val cat = data.categories.firstOrNull { it.id == a.category }
    Text("${cat?.icon ?: ""} ${cat?.name ?: ""}", Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    Text(a.title, Modifier.padding(top = 2.dp, bottom = 10.dp), fontSize = 24.sp, fontWeight = FontWeight.Bold, lineHeight = 30.sp)
    a.body.split(Regex("\n\\s*\n")).forEach { para ->
        para.lines().forEach { line ->
            val item = Regex("^(- |\\d+\\. )").find(line)
            if (item != null) Row(Modifier.padding(start = 4.dp, bottom = 6.dp)) {
                Text(if (item.value == "- ") "•" else item.value.trim(), Modifier.width(22.dp), fontSize = 16.sp)
                Text(line.removePrefix(item.value), fontSize = 16.sp, lineHeight = 24.sp)
            } else Text(line, Modifier.padding(bottom = 2.dp), fontSize = 16.sp, lineHeight = 24.sp)
        }
        Spacer(Modifier.heightIn(min = 10.dp))
    }
    val related = data.articles.filter { it.category == a.category && it.id != a.id }
    if (related.isNotEmpty()) {
        Text("Related", Modifier.padding(top = 8.dp, bottom = 4.dp), fontWeight = FontWeight.SemiBold)
        related.forEach { ArticleRow(it.title) { open(HelpPage.Article(it.id)) } }
    }
    // "Did this help?" Yes thanks them; No offers to ask support with this article attached.
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { ctx.getSharedPreferences("help", android.content.Context.MODE_PRIVATE) }
    var vote by remember(a.id) { mutableStateOf(if (prefs.contains(a.id)) prefs.getBoolean(a.id, true) else null) }
    val answer = { helpful: Boolean ->
        vote = helpful
        prefs.edit().putBoolean(a.id, helpful).apply()
        scope.launch { runCatching { app.api.helpFeedback(a.id, helpful) } }
    }
    val cs = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(12.dp), border = androidx.compose.foundation.BorderStroke(1.dp, cs.outlineVariant), color = cs.surface,
        modifier = Modifier.fillMaxWidth().padding(top = 18.dp)) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            when (vote) {
                null -> {
                    Text("Did this help?", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    androidx.compose.material3.TextButton(onClick = { answer(true) }) { Text("👍 Yes") }
                    androidx.compose.material3.TextButton(onClick = { answer(false) }) { Text("👎 No") }
                }
                true -> {
                    Text("🎉 Glad it helped. Thanks!", Modifier.weight(1f))
                    androidx.compose.material3.TextButton(onClick = { vote = null; prefs.edit().remove(a.id).apply() }) { Text("Change") }
                }
                false -> {
                    Text("Sorry it didn't help.", Modifier.weight(1f))
                    Button(onClick = { open(HelpPage.Contact(a.id)) }) { Text("Ask support") }
                }
            }
        }
    }
    if (vote != false) ContactCard("Didn't answer your question?", "Tell us what you need and we'll get back to you.") { open(HelpPage.Contact(a.id)) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ContactForm(app: PliopadApp, ws: Long?, data: HelpData, articleId: String?, sent: (Long) -> Unit) {
    var about by remember { mutableStateOf(data.articles.firstOrNull { it.id == articleId }) }
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf("question") }
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val att = remember { Attachments() }
    Text("We reply by email and in the Help center. Your app and version are included automatically.", Modifier.padding(vertical = 8.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
    about?.let { art ->
        Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = .6f), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.AutoMirrored.Filled.Article, null, Modifier.size(18.dp))
                Text("About “${art.title}”. We'll see you've already read it.", Modifier.weight(1f).padding(start = 8.dp, top = 8.dp, bottom = 8.dp), fontSize = 13.sp)
                IconButton(onClick = { about = null }) { Icon(Icons.Default.Close, "Not about this article", Modifier.size(18.dp)) }
            }
        }
    }
    Text("What's it about?", Modifier.padding(top = 8.dp), fontWeight = FontWeight.Medium)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { KINDS.forEach { (k, l) -> FilterChip(kind == k, { kind = k }, { Text(l) }) } }
    OutlinedTextField(subject, { subject = it.take(200) }, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Subject") }, singleLine = true)
    OutlinedTextField(body, { body = it }, Modifier.fillMaxWidth().heightIn(min = 160.dp).padding(top = 8.dp), label = { Text("Details") },
        placeholder = { Text("What happened, what you expected, and any steps to reproduce it.") })
    AttachRow(app, att) { error = it }
    error?.let { Text(it, Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.error) }
    Button(enabled = !busy && att.uploading == 0 && subject.isNotBlank() && body.isNotBlank(), modifier = Modifier.padding(top = 12.dp), onClick = {
        busy = true; error = null
        scope.launch {
            runCatching { app.api.openTicket(subject.trim(), body.trim(), kind, ws, BuildConfig.VERSION_NAME, att.ids(), about?.id) }
                .onSuccess { sent(it.id) }.onFailure { error = it.message ?: "Couldn't send. Check your connection."; busy = false }
        }
    }) { Text(if (busy) "Sending…" else "Send to support") }
}

@Composable
private fun RequestView(app: PliopadApp, id: Long) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var t by remember { mutableStateOf<Ticket?>(null) }
    var reply by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val att = remember { Attachments() }
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    LaunchedEffect(id) { runCatching { app.api.ticket(id) }.onSuccess { t = it }.onFailure { error = it.message } }
    val ticket = t ?: return Text(error ?: "Loading…", Modifier.padding(top = 24.dp), color = cs.onSurfaceVariant)
    val fmt = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
    Text(ticket.subject, Modifier.padding(top = 8.dp), fontSize = 22.sp, fontWeight = FontWeight.Bold)
    Text("#${ticket.id} · ${STATUS[ticket.status] ?: ticket.status}" + (ticket.article?.let { " · about “${it.title}”" } ?: ""), fontSize = 13.sp, color = cs.onSurfaceVariant)
    Spacer(Modifier.heightIn(min = 12.dp))
    ticket.messages.forEach { m ->
        Surface(shape = RoundedCornerShape(12.dp), color = if (m.staff) cs.primaryContainer.copy(alpha = .7f) else cs.surfaceVariant.copy(alpha = .6f),
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp, start = if (m.staff) 32.dp else 0.dp, end = if (m.staff) 0.dp else 32.dp)) {
            Column(Modifier.padding(12.dp)) {
                Text((if (m.staff) "${m.author ?: "Support"} · PlioPad support" else "You") + " · " + fmt.format(Date(m.created_at)), fontSize = 12.sp, color = cs.onSurfaceVariant)
                Text(m.body, Modifier.padding(top = 4.dp), fontSize = 15.sp, lineHeight = 21.sp)
                m.files.forEach { f ->
                    Row(Modifier.padding(top = 6.dp).clickable { uri.openUri(f.url) }, verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.AttachFile, null, Modifier.size(16.dp), tint = cs.primary)
                        Text(f.name, Modifier.padding(start = 4.dp), color = cs.primary, fontSize = 14.sp)
                    }
                }
            }
        }
    }
    if (ticket.status == "closed" && ticket.rating == null) Surface(shape = RoundedCornerShape(12.dp), color = cs.surfaceVariant.copy(alpha = .5f), modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("How did we do?", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
            androidx.compose.material3.TextButton(onClick = { scope.launch { runCatching { app.api.rateTicket(id, "good") }.onSuccess { t = it } } }) { Text("👍 Good") }
            androidx.compose.material3.TextButton(onClick = { scope.launch { runCatching { app.api.rateTicket(id, "bad") }.onSuccess { t = it } } }) { Text("👎 Not great") }
        }
    }
    ticket.rating?.let { Text("You rated this ${if (it == "good") "👍 good" else "👎 not great"}. Thanks!", Modifier.padding(top = 6.dp), color = cs.onSurfaceVariant, fontSize = 13.sp) }
    OutlinedTextField(reply, { reply = it }, Modifier.fillMaxWidth().heightIn(min = 110.dp).padding(top = 8.dp),
        placeholder = { Text(if (ticket.status == "closed") "Write to reopen this request…" else "Write a reply…") })
    AttachRow(app, att) { error = it }
    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(enabled = reply.isNotBlank() && att.uploading == 0, onClick = { scope.launch { runCatching { app.api.replyTicket(id, reply.trim(), att.ids()) }.onSuccess { t = it; reply = ""; att.files.clear() }.onFailure { error = it.message } } }) {
            Text(if (ticket.status == "closed") "Reopen and send" else "Send reply")
        }
        if (ticket.status != "closed") OutlinedButton(onClick = { scope.launch { runCatching { app.api.closeTicket(id) }.onSuccess { t = it } } }) { Text("Mark as solved") }
    }
    error?.let { Text(it, Modifier.padding(top = 8.dp), color = cs.error) }
}
