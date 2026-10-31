package app.pliopad.data

import app.pliopad.core.Block
import app.pliopad.core.Blocks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String, val code: String? = null) : IOException(message)

@Serializable data class ServerNote(
    val id: String,
    val notebook_id: String? = null,
    val parent_id: String? = null,
    val kind: String = "note",
    val title: String = "",
    val icon: String? = null,
    val content: JsonElement? = null,
    val props: JsonElement? = null,
    val db_schema: JsonElement? = null,
    val tags: List<String> = emptyList(),
    val pinned: Boolean = false,
    val sort: Double = 0.0,
    val version: Int = 1,
    val updated_by: Long? = null,
    val created_at: Long = 0,
    val updated_at: Long = 0,
    val trashed_at: Long? = null,
    val deleted: Boolean = false,
    val share_slug: String? = null,
    val reminder_at: Long? = null,
    val reminder_done: Boolean = false,
    val is_template: Boolean = false,
    val locked: Boolean = false,
)

@Serializable data class ServerNotebook(val id: String, val name: String, val stack: String? = null, val icon: String? = null, val sort: Double = 0.0, val deleted: Boolean = false)
@Serializable data class ServerTag(val id: String, val name: String, val color: String? = null, val deleted: Boolean = false)
@Serializable data class SyncPull(val seq: Long, val more: Boolean, val notes: List<ServerNote>, val notebooks: List<ServerNotebook>, val tags: List<ServerTag>)
@Serializable data class SyncPushResult(val notes: List<String> = emptyList(), val errors: List<JsonObject> = emptyList())
@Serializable data class MeResponse(val token: String? = null, val user: User, val workspaces: List<Workspace>, val ai: Boolean = false)
@Serializable data class Upload(val id: String, val url: String, val name: String, val mime: String)
@Serializable data class Comment(val id: Long, val user_name: String, val user_color: String? = null, val body: String, val resolved: Int = 0, val created_at: Long)
@Serializable data class Version(val id: Long, val version: Int, val title: String, val created_at: Long, val user_name: String? = null)
@Serializable data class VersionDetail(val id: Long, val title: String, val content: List<Block> = emptyList())
@Serializable data class ShareResult(val share_slug: String? = null, val share_url: String? = null)
@Serializable data class AskSource(val id: String, val title: String, val n: Int)
@Serializable data class AskResult(val answer: String, val sources: List<AskSource> = emptyList())
@Serializable data class Member(val id: Long, val name: String, val email: String = "", val role: String = "member", val color: String? = null)
@Serializable data class MembersResult(val members: List<Member> = emptyList())
@Serializable data class AiResult(val markdown: String? = null, val blocks: List<Block> = emptyList(), val tags: List<String> = emptyList())

/** Thin client for the Pliopad REST API. */
class Api(private val server: () -> String, private val token: () -> String?) {
    private val json = Blocks.json
    private val http = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build()
    private val JSON = "application/json".toMediaType()

    private fun base() = server().trimEnd('/')
    fun serverBase() = base()

    private suspend fun call(method: String, path: String, body: JsonElement? = null, auth: String? = token(), baseUrl: String = base()): String = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(baseUrl + "/api" + path)
            .method(method, body?.let { json.encodeToString(JsonElement.serializer(), it).toRequestBody(JSON) } ?: if (method == "GET") null else "{}".toRequestBody(JSON))
            .apply { auth?.let { header("Authorization", "Bearer $it") } }
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                val err = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                throw ApiException(res.code, err?.get("error")?.jsonPrimitive?.contentOrNull ?: "Request failed (${res.code})", err?.get("code")?.jsonPrimitive?.contentOrNull)
            }
            text
        }
    }

    suspend fun login(server: String, email: String, password: String, code: String?): MeResponse {
        val body = buildJsonObject { put("email", email); put("password", password); put("device", "Android"); code?.let { put("code", it) } }
        return json.decodeFromString(MeResponse.serializer(), call("POST", "/auth/login", body, auth = null, baseUrl = server.trimEnd('/')))
    }

    suspend fun signup(server: String, name: String, email: String, password: String): MeResponse {
        val body = buildJsonObject { put("name", name); put("email", email); put("password", password); put("device", "Android") }
        return json.decodeFromString(MeResponse.serializer(), call("POST", "/auth/signup", body, auth = null, baseUrl = server.trimEnd('/')))
    }

    suspend fun me(): MeResponse = json.decodeFromString(MeResponse.serializer(), call("GET", "/me"))

    suspend fun logout() { runCatching { call("POST", "/auth/logout") } }

    suspend fun pull(ws: Long, since: Long): SyncPull = json.decodeFromString(SyncPull.serializer(), call("GET", "/w/$ws/sync?since=$since"))

    suspend fun push(ws: Long, body: JsonObject): SyncPushResult = json.decodeFromString(SyncPushResult.serializer(), call("POST", "/w/$ws/sync", body))

    suspend fun ai(ws: Long, action: String, noteId: String): AiResult {
        val body = buildJsonObject { put("action", action); put("note_id", noteId) }
        return json.decodeFromString(AiResult.serializer(), call("POST", "/w/$ws/ai", body))
    }

    /** Merges these into the account's preferences (e.g. the Home layout), shared by every device. */
    suspend fun savePrefs(prefs: JsonObject) { call("PATCH", "/me", buildJsonObject { put("prefs", prefs) }) }

    // ---- Online-only features (comments, history, publishing, server search, Ask AI) ----

    suspend fun comments(ws: Long, noteId: String): List<Comment> =
        json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(Comment.serializer()), call("GET", "/w/$ws/notes/$noteId/comments"))

    suspend fun addComment(ws: Long, noteId: String, body: String) {
        call("POST", "/w/$ws/notes/$noteId/comments", buildJsonObject { put("body", body) })
    }

    suspend fun resolveComment(ws: Long, id: Long, resolved: Boolean) {
        call("PATCH", "/w/$ws/comments/$id", buildJsonObject { put("resolved", resolved) })
    }

    suspend fun versions(ws: Long, noteId: String): List<Version> =
        json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(Version.serializer()), call("GET", "/w/$ws/notes/$noteId/versions"))

    suspend fun version(ws: Long, id: Long): VersionDetail = json.decodeFromString(VersionDetail.serializer(), call("GET", "/w/$ws/versions/$id"))

    suspend fun restoreVersion(ws: Long, id: Long): ServerNote = json.decodeFromString(ServerNote.serializer(), call("POST", "/w/$ws/versions/$id/restore"))

    suspend fun share(ws: Long, noteId: String, enabled: Boolean): ShareResult =
        json.decodeFromString(ShareResult.serializer(), call("POST", "/w/$ws/notes/$noteId/share", buildJsonObject { put("enabled", enabled) }))

    suspend fun search(ws: Long, q: String): List<ServerNote> =
        json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(ServerNote.serializer()), call("GET", "/w/$ws/search?q=" + java.net.URLEncoder.encode(q, "UTF-8")))

    suspend fun ask(ws: Long, question: String): AskResult =
        json.decodeFromString(AskResult.serializer(), call("POST", "/w/$ws/ai/ask", buildJsonObject { put("question", question) }))

    suspend fun members(ws: Long): List<Member> =
        json.decodeFromString(MembersResult.serializer(), call("GET", "/w/$ws/members")).members

    suspend fun upload(ws: Long, file: File, mime: String, noteId: String?, ocr: String?): Upload = withContext(Dispatchers.IO) {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", file.name, file.asRequestBody(mime.toMediaType()))
            .apply { noteId?.let { addFormDataPart("note_id", it) }; ocr?.takeIf { it.isNotBlank() }?.let { addFormDataPart("ocr", it) } }
            .build()
        val req = Request.Builder().url(base() + "/api/w/$ws/files").post(form).header("Authorization", "Bearer ${token()}").build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw ApiException(res.code, "Upload failed (${res.code})")
            json.decodeFromString(Upload.serializer(), text)
        }
    }

    companion object {
        fun noteToJson(n: NoteEntity): JsonObject = buildJsonObject {
            put("id", n.id)
            if (n.deleted) { put("deleted", true); return@buildJsonObject }
            put("title", n.title)
            put("icon", n.icon?.let { JsonPrimitive(it) } ?: JsonNull)
            put("notebook_id", n.notebookId?.let { JsonPrimitive(it) } ?: JsonNull)
            put("parent_id", n.parentId?.let { JsonPrimitive(it) } ?: JsonNull)
            put("kind", n.kind)
            put("content", Blocks.json.parseToJsonElement(n.content))
            n.props?.let { put("props", Blocks.json.parseToJsonElement(it)) }
            n.dbSchema?.let { put("db_schema", Blocks.json.parseToJsonElement(it)) }
            put("tags", Blocks.json.parseToJsonElement(n.tags))
            put("pinned", n.pinned)
            put("sort", n.sort)
            put("reminder_at", n.reminderAt?.let { JsonPrimitive(it) } ?: JsonNull)
            put("reminder_done", n.reminderDone)
            put("is_template", n.isTemplate)
            put("locked", n.locked)
            put("trashed_at", n.trashedAt?.let { JsonPrimitive(it) } ?: JsonNull)
            put("created_at", n.createdAt)
            if (n.version > 0) { put("base_version", n.version); put("base_updated", n.baseUpdated) }
        }

        fun fromServer(ws: Long, s: ServerNote): NoteEntity {
            val content = s.content?.takeIf { it is JsonArray }?.toString() ?: "[]"
            return NoteEntity(
                id = s.id, wsId = ws, notebookId = s.notebook_id, parentId = s.parent_id, kind = s.kind, title = s.title, icon = s.icon,
                content = content, plain = Blocks.plain(Blocks.parse(content)),
                props = s.props?.takeIf { it is JsonObject }?.toString(), dbSchema = s.db_schema?.takeIf { it is JsonObject }?.toString(),
                tags = Blocks.json.encodeToString(kotlinx.serialization.builtins.ListSerializer(String.serializer()), s.tags),
                pinned = s.pinned, sort = s.sort, version = s.version, baseUpdated = s.updated_at, createdAt = s.created_at, updatedAt = s.updated_at,
                updatedBy = s.updated_by, trashedAt = s.trashed_at, reminderAt = s.reminder_at, reminderDone = s.reminder_done,
                isTemplate = s.is_template, locked = s.locked, shareSlug = s.share_slug,
            )
        }
    }
}
