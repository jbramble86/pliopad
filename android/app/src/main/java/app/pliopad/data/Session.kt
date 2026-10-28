package app.pliopad.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

private val Context.store by preferencesDataStore("session")

@Serializable data class Workspace(val id: Long, val name: String, val role: String = "member", val plan: String = "free")
@Serializable data class User(val id: Long, val email: String, val name: String, val color: String? = null)

data class SessionData(
    val server: String = "",
    val token: String? = null,
    val user: User? = null,
    val workspaces: List<Workspace> = emptyList(),
    val wsId: Long = 0,
    val appLock: Boolean = false,
    val ai: Boolean = false,
) {
    val signedIn get() = token != null && user != null
    val workspace get() = workspaces.firstOrNull { it.id == wsId } ?: workspaces.firstOrNull()
}

/** Sign-in state and preferences, kept in DataStore. */
class Session(private val ctx: Context) {
    private object K {
        val server = stringPreferencesKey("server")
        val token = stringPreferencesKey("token")
        val user = stringPreferencesKey("user")
        val workspaces = stringPreferencesKey("workspaces")
        val ws = longPreferencesKey("ws")
        val lock = booleanPreferencesKey("app_lock")
        val ai = booleanPreferencesKey("ai")
    }
    private val json = app.pliopad.core.Blocks.json

    val data: Flow<SessionData> = ctx.store.data.map { p ->
        SessionData(
            server = p[K.server] ?: "",
            token = p[K.token],
            user = p[K.user]?.let { runCatching { json.decodeFromString(User.serializer(), it) }.getOrNull() },
            workspaces = p[K.workspaces]?.let { runCatching { json.decodeFromString(ListSerializer(Workspace.serializer()), it) }.getOrNull() } ?: emptyList(),
            wsId = p[K.ws] ?: 0,
            appLock = p[K.lock] ?: false,
            ai = p[K.ai] ?: false,
        )
    }

    suspend fun current() = data.first()

    suspend fun signIn(server: String, token: String, user: User, workspaces: List<Workspace>, ai: Boolean) = ctx.store.edit { p ->
        p[K.server] = server
        p[K.token] = token
        p[K.user] = json.encodeToString(User.serializer(), user)
        p[K.workspaces] = json.encodeToString(ListSerializer(Workspace.serializer()), workspaces)
        p[K.ai] = ai
        if ((p[K.ws] ?: 0L) !in workspaces.map { it.id }) p[K.ws] = workspaces.firstOrNull()?.id ?: 0L
    }

    suspend fun updateWorkspaces(workspaces: List<Workspace>, ai: Boolean) = ctx.store.edit { p ->
        p[K.workspaces] = json.encodeToString(ListSerializer(Workspace.serializer()), workspaces)
        p[K.ai] = ai
    }

    suspend fun setServer(server: String) = ctx.store.edit { it[K.server] = server }
    suspend fun setWorkspace(id: Long) = ctx.store.edit { it[K.ws] = id }
    suspend fun setAppLock(on: Boolean) = ctx.store.edit { it[K.lock] = on }
    suspend fun signOut() = ctx.store.edit { p -> p.remove(K.token); p.remove(K.user); p.remove(K.workspaces) }
}
