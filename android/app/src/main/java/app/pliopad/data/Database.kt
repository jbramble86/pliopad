package app.pliopad.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** Local, offline-first copy of a workspace. `dirty` rows are pushed on the next sync; `rev` guards edits made during a push. */
@Entity(tableName = "notes", indices = [Index("wsId", "updatedAt"), Index("parentId"), Index("notebookId")])
data class NoteEntity(
    @PrimaryKey val id: String,
    val wsId: Long,
    val notebookId: String? = null,
    val parentId: String? = null,
    val kind: String = "note",
    val title: String = "",
    val icon: String? = null,
    val content: String = "[]",
    val plain: String = "",
    val props: String? = null,
    val dbSchema: String? = null,
    val tags: String = "[]",
    val pinned: Boolean = false,
    val sort: Double = 0.0,
    val version: Int = 0,
    val baseUpdated: Long = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val updatedBy: Long? = null,
    val trashedAt: Long? = null,
    val reminderAt: Long? = null,
    val reminderDone: Boolean = false,
    val isTemplate: Boolean = false,
    val locked: Boolean = false,
    val shareSlug: String? = null,
    val dirty: Boolean = false,
    val rev: Int = 0,
    val deleted: Boolean = false,
)

@Entity(tableName = "notebooks", indices = [Index("wsId")])
data class NotebookEntity(
    @PrimaryKey val id: String,
    val wsId: Long,
    val name: String,
    val stack: String? = null,
    val icon: String? = null,
    val sort: Double = 0.0,
    val dirty: Boolean = false,
    val deleted: Boolean = false,
)

@Entity(tableName = "tags", indices = [Index("wsId")])
data class TagEntity(
    @PrimaryKey val id: String,
    val wsId: Long,
    val name: String,
    val color: String? = null,
    val dirty: Boolean = false,
    val deleted: Boolean = false,
)

@Entity(tableName = "sync_state")
data class SyncState(@PrimaryKey val wsId: Long, val seq: Long = 0, val lastSync: Long = 0)

@Dao
interface PliopadDao {
    // ---- Notes ----
    @Query("""SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND isTemplate=0
        AND (parentId IS NULL OR parentId NOT IN (SELECT id FROM notes WHERE kind='db'))
        ORDER BY pinned DESC, updatedAt DESC""")
    fun allNotes(ws: Long): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND isTemplate=0 AND notebookId=:nb ORDER BY pinned DESC, updatedAt DESC")
    fun notebookNotes(ws: Long, nb: String): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND tags LIKE '%' || :tag || '%' ORDER BY updatedAt DESC")
    fun tagNotes(ws: Long, tag: String): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND pinned=1 ORDER BY updatedAt DESC")
    fun pinnedNotes(ws: Long): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND reminderAt IS NOT NULL ORDER BY reminderDone, reminderAt")
    fun reminderNotes(ws: Long): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NOT NULL ORDER BY trashedAt DESC")
    fun trashNotes(ws: Long): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND notebookId IS NULL AND parentId IS NULL AND isTemplate=0 ORDER BY sort, createdAt")
    fun topPages(ws: Long): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE parentId=:id AND deleted=0 AND trashedAt IS NULL ORDER BY sort, createdAt")
    fun children(id: String): Flow<List<NoteEntity>>

    @Query("""SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND (title LIKE '%' || :q || '%' OR plain LIKE '%' || :q || '%')
        ORDER BY (title LIKE '%' || :q || '%') DESC, updatedAt DESC LIMIT 100""")
    suspend fun search(ws: Long, q: String): List<NoteEntity>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND isTemplate=0 AND content LIKE '%\"t\":\"todo\"%' ORDER BY updatedAt DESC")
    fun notesWithTodos(ws: Long): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND isTemplate=0")
    suspend fun allNotesList(ws: Long): List<NoteEntity>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL ORDER BY updatedAt DESC LIMIT :n")
    suspend fun recent(ws: Long, n: Int): List<NoteEntity>

    @Query("SELECT id, title, icon FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL")
    fun titles(ws: Long): Flow<List<NoteTitle>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND isTemplate=0 AND content LIKE '%\"t\":\"todo\"%' ORDER BY updatedAt DESC")
    suspend fun notesWithTodosList(ws: Long): List<NoteEntity>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND pinned=1 ORDER BY updatedAt DESC")
    suspend fun pinnedList(ws: Long): List<NoteEntity>

    @Query("SELECT * FROM notes WHERE notebookId=:nb AND deleted=0 AND trashedAt IS NULL")
    suspend fun notesInNotebook(nb: String): List<NoteEntity>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NOT NULL")
    suspend fun trashList(ws: Long): List<NoteEntity>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND title=:title AND deleted=0 AND trashedAt IS NULL LIMIT 1")
    suspend fun noteByTitle(ws: Long, title: String): NoteEntity?

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND isTemplate=1 ORDER BY title")
    fun templates(ws: Long): Flow<List<NoteEntity>>

    /** Notes that link to this one: [Title](note:ID) links and child-page blocks. */
    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND id<>:id AND content LIKE '%' || :id || '%'")
    fun backlinks(ws: Long, id: String): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE wsId=:ws AND deleted=0 AND trashedAt IS NULL AND isTemplate=0 ORDER BY title")
    fun allForPicker(ws: Long): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notebooks WHERE id=:id")
    suspend fun notebookById(id: String): NotebookEntity?

    @Query("SELECT * FROM tags WHERE id=:id")
    suspend fun tagById(id: String): TagEntity?

    @Query("SELECT * FROM notes WHERE id=:id")
    fun noteFlow(id: String): Flow<NoteEntity?>

    @Query("SELECT * FROM notes WHERE id=:id")
    suspend fun note(id: String): NoteEntity?

    @Upsert suspend fun upsertNote(n: NoteEntity)
    @Upsert suspend fun upsertNotes(n: List<NoteEntity>)

    @Query("SELECT * FROM notes WHERE wsId=:ws AND dirty=1")
    suspend fun dirtyNotes(ws: Long): List<NoteEntity>

    @Query("UPDATE notes SET dirty=0 WHERE id=:id AND rev=:rev")
    suspend fun markClean(id: String, rev: Int)

    @Query("DELETE FROM notes WHERE id=:id")
    suspend fun deleteNote(id: String)

    @Query("SELECT * FROM notes WHERE wsId=:ws AND reminderAt > :now AND reminderDone=0 AND deleted=0 AND trashedAt IS NULL")
    suspend fun upcomingReminders(ws: Long, now: Long): List<NoteEntity>

    // ---- Notebooks & tags ----
    @Query("SELECT * FROM notebooks WHERE wsId=:ws AND deleted=0 ORDER BY stack, sort, name")
    fun notebooks(ws: Long): Flow<List<NotebookEntity>>

    @Query("SELECT * FROM notebooks WHERE wsId=:ws AND deleted=0 ORDER BY sort, name")
    suspend fun notebookList(ws: Long): List<NotebookEntity>

    @Upsert suspend fun upsertNotebook(n: NotebookEntity)
    @Upsert suspend fun upsertNotebooks(n: List<NotebookEntity>)

    @Query("SELECT * FROM notebooks WHERE wsId=:ws AND dirty=1")
    suspend fun dirtyNotebooks(ws: Long): List<NotebookEntity>

    @Query("UPDATE notebooks SET dirty=0 WHERE id IN (:ids)")
    suspend fun cleanNotebooks(ids: List<String>)

    @Query("SELECT * FROM tags WHERE wsId=:ws AND deleted=0 ORDER BY name")
    fun tags(ws: Long): Flow<List<TagEntity>>

    @Upsert suspend fun upsertTag(t: TagEntity)
    @Upsert suspend fun upsertTags(t: List<TagEntity>)

    @Query("SELECT * FROM tags WHERE wsId=:ws AND dirty=1")
    suspend fun dirtyTags(ws: Long): List<TagEntity>

    @Query("UPDATE tags SET dirty=0 WHERE id IN (:ids)")
    suspend fun cleanTags(ids: List<String>)

    // ---- Sync state ----
    @Query("SELECT * FROM sync_state WHERE wsId=:ws")
    suspend fun syncState(ws: Long): SyncState?

    @Query("SELECT * FROM sync_state WHERE wsId=:ws")
    fun syncStateFlow(ws: Long): Flow<SyncState?>

    @Upsert suspend fun saveSyncState(s: SyncState)

    @Query("SELECT COUNT(*) FROM notes WHERE wsId=:ws AND dirty=1")
    fun pendingCount(ws: Long): Flow<Int>
}

data class NoteTitle(val id: String, val title: String, val icon: String?)

@Database(entities = [NoteEntity::class, NotebookEntity::class, TagEntity::class, SyncState::class], version = 1, exportSchema = true)
abstract class PliopadDatabase : RoomDatabase() {
    abstract fun dao(): PliopadDao

    companion object {
        @Volatile private var instance: PliopadDatabase? = null
        fun get(ctx: Context): PliopadDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(ctx.applicationContext, PliopadDatabase::class.java, "pliopad.db")
                .fallbackToDestructiveMigration() // the server is the source of truth; a fresh sync restores everything
                .build().also { instance = it }
        }
    }
}
