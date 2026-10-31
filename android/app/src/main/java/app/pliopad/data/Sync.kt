package app.pliopad.data

import app.pliopad.core.Blocks
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * Two-way sync for one workspace:
 * 1. upload images that are still local, 2. push dirty rows (each note carries the server version it was based on, so the
 * server merges concurrent edits block by block), 3. pull everything newer than our sequence number.
 */
class SyncEngine(private val dao: PliopadDao, private val api: Api) {

    /** Notes the server turned down on the last push, as "Title: reason", so the app can say why they are not syncing. */
    var rejected: List<String> = emptyList()
        private set

    suspend fun run(ws: Long): Int {
        uploadPending(ws)
        push(ws)
        return pull(ws)
    }

    private suspend fun uploadPending(ws: Long) {
        for (n in dao.dirtyNotes(ws)) {
            if (!n.content.contains("\"local:")) continue
            val blocks = Blocks.parse(n.content).map { b ->
                val src = b.src
                if (src == null || !src.startsWith("local:")) return@map b
                val file = File(src.removePrefix("local:"))
                if (!file.exists()) return@map b
                val up = api.upload(ws, file, "image/jpeg", n.id, null)
                file.delete()
                b.copy(src = up.url, u = System.currentTimeMillis())
            }
            val fresh = dao.note(n.id) ?: continue
            // Only replace the sources, keeping any edits made while uploading.
            val bySrc = blocks.associateBy { it.id }
            val merged = Blocks.parse(fresh.content).map { b -> if (b.src?.startsWith("local:") == true) bySrc[b.id] ?: b else b }
            dao.upsertNote(fresh.copy(content = Blocks.encode(merged)))
        }
    }

    private suspend fun push(ws: Long) {
        val notes = dao.dirtyNotes(ws)
        val notebooks = dao.dirtyNotebooks(ws)
        val tags = dao.dirtyTags(ws)
        if (notes.isEmpty() && notebooks.isEmpty() && tags.isEmpty()) return
        val body = buildJsonObject {
            put("notebooks", JsonArray(notebooks.map { nb -> buildJsonObject { put("id", nb.id); put("name", nb.name); nb.stack?.let { put("stack", it) }; nb.icon?.let { put("icon", it) }; put("sort", nb.sort); put("deleted", nb.deleted) } }))
            put("tags", JsonArray(tags.map { t -> buildJsonObject { put("id", t.id); put("name", t.name); t.color?.let { put("color", it) }; put("deleted", t.deleted) } }))
            put("notes", JsonArray(notes.map { Api.noteToJson(it) }))
        }
        val res = api.push(ws, body)
        rejected = res.errors.map { e ->
            val id = e["id"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
            val title = notes.firstOrNull { it.id == id }?.title?.ifBlank { "Untitled" } ?: "A note"
            "$title: " + ((e["error"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "rejected")
        }
        val ok = res.notes.toSet()
        for (n in notes) {
            if (n.id !in ok) continue
            if (n.deleted) dao.deleteNote(n.id) else dao.markClean(n.id, n.rev)
        }
        if (notebooks.isNotEmpty()) dao.cleanNotebooks(notebooks.map { it.id })
        if (tags.isNotEmpty()) dao.cleanTags(tags.map { it.id })
    }

    private suspend fun pull(ws: Long): Int {
        var state = dao.syncState(ws) ?: SyncState(ws)
        var changed = 0
        do {
            val r = api.pull(ws, state.seq)
            dao.upsertNotebooks(r.notebooks.map { NotebookEntity(it.id, ws, it.name, it.stack, it.icon, it.sort, deleted = it.deleted) })
            dao.upsertTags(r.tags.map { TagEntity(it.id, ws, it.name, it.color, deleted = it.deleted) })
            for (s in r.notes) {
                val local = dao.note(s.id)
                when {
                    s.deleted -> dao.deleteNote(s.id)
                    // Local edits win for now; they are pushed against the old base, and the server merges them.
                    local?.dirty == true -> continue
                    else -> dao.upsertNote(Api.fromServer(ws, s))
                }
                changed++
            }
            state = state.copy(seq = r.seq, lastSync = System.currentTimeMillis())
            dao.saveSyncState(state)
        } while (r.more)
        return changed
    }
}
