package app.pliopad.data

import android.content.Context
import android.net.Uri
import app.pliopad.core.Block
import app.pliopad.core.Blocks
import app.pliopad.work.SyncWorker
import app.pliopad.widget.Widgets
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.util.UUID

/** All local writes go through here: they update Room, mark rows dirty and ask for a background sync. */
class Repo(private val ctx: Context, val dao: PliopadDao, val session: Session) {
    private val tagSer = ListSerializer(String.serializer())

    // Never let scheduling a background sync break a local save; the periodic sync catches up.
    private fun requestSync() {
        runCatching { SyncWorker.requestSoon(ctx) }
        Widgets.refreshSoon(ctx)
    }

    suspend fun ws(): Long = session.current().let { it.workspace?.id ?: 0 }

    suspend fun defaultNotebook(ws: Long): String? {
        val nbs = dao.notebookList(ws)
        return (nbs.firstOrNull { it.name.equals("Inbox", true) } ?: nbs.firstOrNull())?.id
    }

    suspend fun createNote(
        title: String = "", blocks: List<Block> = emptyList(), notebookId: String? = null, parentId: String? = null,
        useDefaultNotebook: Boolean = true, kind: String = "note", dbSchema: String? = null, props: String? = null,
    ): String {
        val ws = ws()
        val id = UUID.randomUUID().toString()
        // Every page lives in a notebook: sub-pages and database rows share their parent's, everything else defaults to the Inbox.
        val nb = parentId?.let { dao.note(it)?.notebookId } ?: notebookId ?: defaultNotebook(ws)
        val content = Blocks.encode(blocks)
        dao.upsertNote(NoteEntity(id = id, wsId = ws, notebookId = nb, parentId = parentId, title = title, content = content,
            plain = Blocks.plain(blocks), kind = kind, dbSchema = dbSchema, props = props, dirty = true, rev = 1, sort = System.currentTimeMillis().toDouble()))
        requestSync()
        return id
    }

    suspend fun update(id: String, change: (NoteEntity) -> NoteEntity) {
        val n = dao.note(id) ?: return
        val next = change(n)
        dao.upsertNote(next.copy(plain = Blocks.plain(Blocks.parse(next.content)), dirty = true, rev = n.rev + 1, updatedAt = System.currentTimeMillis()))
        requestSync()
    }

    suspend fun saveContent(id: String, title: String, blocks: List<Block>) = update(id) { it.copy(title = title, content = Blocks.encode(blocks)) }
    suspend fun setPinned(id: String, v: Boolean) = update(id) { it.copy(pinned = v) }
    suspend fun setIcon(id: String, icon: String?) = update(id) { it.copy(icon = icon) }
    suspend fun moveTo(id: String, notebookId: String?) = update(id) { it.copy(notebookId = notebookId) }
    suspend fun setReminder(id: String, at: Long?) = update(id) { it.copy(reminderAt = at, reminderDone = false) }
    suspend fun setCreated(id: String, at: Long) = update(id) { it.copy(createdAt = minOf(at, System.currentTimeMillis())) }
    suspend fun trash(id: String) = update(id) { it.copy(trashedAt = System.currentTimeMillis()) }
    suspend fun restore(id: String) = update(id) { it.copy(trashedAt = null) }
    suspend fun deleteForever(id: String) = update(id) { it.copy(deleted = true) }

    fun tagsOf(n: NoteEntity): List<String> = runCatching { Blocks.json.decodeFromString(tagSer, n.tags) }.getOrDefault(emptyList())
    suspend fun setTags(id: String, tags: List<String>) = update(id) { it.copy(tags = Blocks.json.encodeToString(tagSer, tags)) }

    fun propsOf(n: NoteEntity): Map<String, String> = runCatching {
        Blocks.json.parseToJsonElement(n.props ?: "{}").jsonObject.mapValues { (_, v) -> (v as? JsonPrimitive)?.content ?: v.toString() }
    }.getOrDefault(emptyMap())

    suspend fun setProp(id: String, key: String, value: String?) = update(id) { n ->
        val cur = runCatching { Blocks.json.parseToJsonElement(n.props ?: "{}").jsonObject }.getOrDefault(JsonObject(emptyMap())).toMutableMap()
        if (value == null) cur.remove(key) else cur[key] = JsonPrimitive(value)
        n.copy(props = JsonObject(cur).toString())
    }

    suspend fun toggleTask(noteId: String, blockId: String) = update(noteId) { n ->
        val blocks = Blocks.parse(n.content).map { if (it.id == blockId) it.copy(c = if (it.checked) null else true, u = System.currentTimeMillis()) else it }
        n.copy(content = Blocks.encode(blocks))
    }

    // ---- Notebooks and stacks (a stack is a name shared by notebooks; it exists while a notebook is in it) ----

    private suspend fun updateNotebook(id: String, change: (NotebookEntity) -> NotebookEntity) {
        val nb = dao.notebookById(id) ?: return
        dao.upsertNotebook(change(nb).copy(dirty = true))
        requestSync()
    }

    suspend fun renameNotebook(id: String, name: String) = updateNotebook(id) { it.copy(name = name.trim().ifBlank { it.name }) }
    suspend fun setNotebookIcon(id: String, icon: String?) = updateNotebook(id) { it.copy(icon = icon ?: "📓") }
    suspend fun setNotebookStack(id: String, stack: String?) = updateNotebook(id) { it.copy(stack = stack?.trim()?.ifBlank { null }) }

    suspend fun createNotebook(name: String, stack: String?): String {
        val id = UUID.randomUUID().toString()
        dao.upsertNotebook(NotebookEntity(id = id, wsId = ws(), name = name.trim().ifBlank { "Untitled" }, stack = stack, icon = "📓", sort = 99.0, dirty = true))
        requestSync()
        return id
    }

    /** Deleting a notebook moves its notes to the trash (restorable for 30 days), like on the web. */
    suspend fun deleteNotebook(id: String) {
        val now = System.currentTimeMillis()
        for (n in dao.notesInNotebook(id)) dao.upsertNote(n.copy(trashedAt = now, notebookId = null, dirty = true, rev = n.rev + 1, updatedAt = now))
        updateNotebook(id) { it.copy(deleted = true) }
    }

    suspend fun renameStack(old: String, new: String) { for (nb in dao.notebookList(ws()).filter { it.stack == old }) setNotebookStack(nb.id, new) }
    suspend fun ungroupStack(stack: String) { for (nb in dao.notebookList(ws()).filter { it.stack == stack }) setNotebookStack(nb.id, null) }

    // ---- Tags ----

    suspend fun renameTag(id: String, name: String) {
        val t = dao.tagById(id) ?: return
        dao.upsertTag(t.copy(name = name.trim().removePrefix("#").ifBlank { t.name }, dirty = true))
        requestSync()
    }

    suspend fun deleteTag(id: String) {
        val t = dao.tagById(id) ?: return
        dao.upsertTag(t.copy(deleted = true, dirty = true))
        requestSync()
    }

    // ---- Notes ----

    suspend fun duplicate(id: String, asNewFromTemplate: Boolean = false): String? {
        val n = dao.note(id) ?: return null
        val blocks = Blocks.parse(n.content).map { it.copy(id = UUID.randomUUID().toString(), u = System.currentTimeMillis()) }
        val title = if (asNewFromTemplate) "${n.title} ${java.text.DateFormat.getDateInstance().format(java.util.Date())}" else "${n.title.ifBlank { "Untitled" }} (copy)"
        val newId = createNote(title = title, blocks = blocks, notebookId = n.notebookId, parentId = if (asNewFromTemplate) null else n.parentId,
            useDefaultNotebook = n.notebookId == null && asNewFromTemplate, kind = n.kind, dbSchema = n.dbSchema, props = n.props)
        update(newId) { it.copy(icon = n.icon, tags = n.tags) }
        return newId
    }

    suspend fun setTemplate(id: String, v: Boolean) = update(id) { it.copy(isTemplate = v) }

    suspend fun emptyTrash() { for (n in dao.trashList(ws())) deleteForever(n.id) }

    /** Today's journal page: opens it if it exists, otherwise creates it in a "Journal" notebook. */
    suspend fun dailyNote(): String {
        val ws = ws()
        val title = java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy"))
        dao.noteByTitle(ws, title)?.let { return it.id }
        val journal = dao.notebookList(ws).firstOrNull { it.name == "Journal" }?.id ?: createNotebook("Journal", null).also { setNotebookIcon(it, "📔") }
        return createNote(title = title, notebookId = journal, blocks = Blocks.fromMarkdown("## Top 3 today\n- [ ] \n## Notes\n\n## Wins"))
    }

    suspend fun createTag(name: String): String {
        val id = UUID.randomUUID().toString()
        dao.upsertTag(TagEntity(id = id, wsId = ws(), name = name.trim().removePrefix("#"), dirty = true))
        requestSync()
        return id
    }

    /** Copies an image (camera, scanner, share sheet) into app storage; the block points at it until sync uploads it. */
    fun importImage(uri: Uri): String {
        val dir = File(ctx.filesDir, "pending").apply { mkdirs() }
        val f = File(dir, "${UUID.randomUUID()}.jpg")
        ctx.contentResolver.openInputStream(uri)?.use { input -> f.outputStream().use { input.copyTo(it) } }
        return "local:" + f.absolutePath
    }

    /** Text shared from another app becomes a new note: a link becomes a bookmark, anything else becomes paragraphs. */
    suspend fun fromShare(text: String?, subject: String?, images: List<Uri>): String {
        val blocks = mutableListOf<Block>()
        val trimmed = text?.trim().orEmpty()
        val url = Regex("""https?://\S+""").find(trimmed)?.value
        if (url != null && trimmed.length - url.length < 4) blocks += Block(t = "bookmark", x = subject ?: url, src = url)
        else if (trimmed.isNotEmpty()) blocks += Blocks.fromMarkdown(trimmed)
        images.forEach { blocks += Block(t = "img", src = importImage(it)) }
        val title = subject?.takeIf { it.isNotBlank() } ?: trimmed.lineSequence().firstOrNull()?.take(80) ?: "Shared image"
        return createNote(title = title, blocks = blocks.ifEmpty { listOf(Block()) })
    }
}
