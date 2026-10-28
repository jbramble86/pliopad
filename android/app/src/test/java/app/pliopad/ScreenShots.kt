package app.pliopad

import android.content.Intent
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.pliopad.core.Block
import app.pliopad.core.Blocks
import app.pliopad.data.NoteEntity
import app.pliopad.data.NotebookEntity
import app.pliopad.data.SyncState
import app.pliopad.data.TagEntity
import app.pliopad.data.User
import app.pliopad.data.Workspace
import app.pliopad.ui.DEFAULT_DB_SCHEMA
import com.github.takahirom.roborazzi.captureRoboImage
import androidx.compose.ui.unit.dp
import app.pliopad.widget.NoteContent
import app.pliopad.widget.QuickContent
import app.pliopad.widget.ShortcutsContent
import app.pliopad.widget.TasksContent
import app.pliopad.widget.GraphContent
import app.pliopad.ui.GraphModel
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate

/**
 * Pictures of the main screens on a phone and on an unfolded foldable, filled with a sample workspace.
 * Only runs when asked: ./gradlew testDebugUnitTest -Pshots --tests 'app.pliopad.ScreenShots*'   (pictures land in build/shots/)
 */
/** Shared setup; each device size is its own class so it gets a fresh process (and database). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
abstract class ScreenShotsBase {
    @get:Rule val compose = createEmptyComposeRule()

    private val seededContent = mutableMapOf<String, String>()
    protected val roadmap = "11111111-1111-4111-8111-111111111111"
    private val welcome = "22222222-2222-4222-8222-222222222222"

    @Before fun workspace() {
        val app = ApplicationProvider.getApplicationContext<PliopadApp>()
        val dao = app.dao
        val ws = 1L
        val now = System.currentTimeMillis()
        val today = LocalDate.now()
        fun note(id: String, title: String, icon: String?, nb: String?, md: String, ageMin: Long, pinned: Boolean = false, parent: String? = null, kind: String = "note", schema: String? = null, props: String? = null) =
            NoteEntity(id = id, wsId = ws, notebookId = nb, parentId = parent, title = title, icon = icon, content = Blocks.encode(Blocks.fromMarkdown(md)),
                plain = Blocks.plain(Blocks.fromMarkdown(md)), pinned = pinned, version = 1, updatedAt = now - ageMin * 60_000, createdAt = now - ageMin * 120_000,
                kind = kind, dbSchema = schema, props = props)
        runBlocking {
            // A server that refuses at once, so background syncs fail quietly and keep this data.
            app.session.signIn("http://127.0.0.1:9", "test", User(1, "ada@example.com", "Ada Lovelace", "#6366f1"), listOf(Workspace(1, "Acme Inc.", "owner", "business")), ai = true)
            dao.saveSyncState(SyncState(ws, 10, now))
            dao.upsertNotebooks(listOf(
                NotebookEntity("nb-inbox", ws, "Inbox", null, "📥", 0.0), NotebookEntity("nb-proj", ws, "Projects", "Work", "🚀", 1.0),
                NotebookEntity("nb-meet", ws, "Meetings", "Work", "🗓️", 2.0), NotebookEntity("nb-home", ws, "Home & family", null, "🏠", 3.0),
            ))
            dao.upsertTags(listOf(TagEntity("t1", ws, "launch"), TagEntity("t2", ws, "ideas")))
            dao.upsertNotes(listOf(
                note(welcome, "Welcome to Pliopad", "👋", "nb-inbox", "## Notes and docs in one place\nPliopad mixes **Evernote-style notebooks** with **Notion-style pages**.\n- [ ] Type / for blocks\n- [x] Sign in on your phone", 3, pinned = true),
                note("33333333-3333-4333-8333-333333333333", "Q4 launch plan", "🚀", "nb-proj", "## Goals\nShip the **foldable** experience.\n- [ ] Final QA pass @${today}\n- [ ] Press kit @${today.plusDays(2)}\n- [ ] Pricing page @${today.minusDays(1)}\n> Launch on the 14th.", 12, pinned = true),
                note("44444444-4444-4444-8444-444444444444", "Weekly sync", "🗓️", "nb-meet", "## Attendees\n- Ada\n- Grace\n## Action items\n- [ ] Send the recap\n- [ ] Book the venue @${today.plusDays(5)}", 50),
                note("55555555-5555-4555-8555-555555555555", "Grocery list", "🛒", "nb-home", "- [ ] Oat milk\n- [ ] Coffee beans\n- [x] Bread", 140),
                note("66666666-6666-4666-8666-666666666666", "Reading notes: Deep Work", "📚", "nb-inbox", "Focus is a **skill**. Batch shallow work.", 600),
                note("77777777-7777-4777-8777-777777777777", "Scratch pad", "🗒️", null, "Call the printer vendor\n- [ ] renew the domain", 1),
                note(roadmap, "Product roadmap", "🗺️", "nb-proj", "Every row is a page.", 30, kind = "db", schema = DEFAULT_DB_SCHEMA),
                note("88888888-8888-4888-8888-888888888888", "Offline sync", null, null, "", 31, parent = roadmap, props = """{"status":"done","date":"${today.minusDays(3)}"}"""),
                note("99999999-9999-4999-8999-999999999999", "Foldable layout", null, null, "", 32, parent = roadmap, props = """{"status":"doing","date":"${today.plusDays(4)}"}"""),
                note("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Customer interviews", null, null, "", 33, parent = roadmap, props = """{"status":"todo","date":"${today.plusDays(9)}"}"""),
            ).map { if (it.id == "55555555-5555-4555-8555-555555555555") it.copy(reminderAt = now + 3 * 3600_000) else it }
                .also { list -> list.forEach { seededContent[it.id] = it.content } })
        }
    }

    protected fun shoot(device: String, name: String, intent: Intent.() -> Unit = {}) {
        val dir = System.getProperty("shots.dir") + "/" + device
        val i = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java).apply(intent)
        ActivityScenario.launch<MainActivity>(i).use {
            repeat(3) { compose.waitForIdle(); Thread.sleep(250) }
            compose.onRoot().captureRoboImage("$dir/$name.png")
        }
        // Just looking at screens must never create edits to sync.
        Thread.sleep(400)
        val app = ApplicationProvider.getApplicationContext<PliopadApp>()
        val dirty = runBlocking { app.dao.dirtyNotes(1) }
        if (dirty.isNotEmpty()) {
            val n = dirty.first()
            val seeded = seededContent[n.id]
            throw AssertionError("Viewing $device/$name changed “${n.title}”.\nseeded: $seeded\nnow:    ${n.content}")
        }
    }
}

class ScreenShotsPhone : ScreenShotsBase() {
    @Config(qualifiers = "w411dp-h891dp-xxhdpi")
    @Test fun phone() {
        shoot("phone", "home")
        shoot("phone", "note") { putExtra(MainActivity.EXTRA_NOTE, "33333333-3333-4333-8333-333333333333") }
        shoot("phone", "database") { putExtra(MainActivity.EXTRA_NOTE, roadmap) }
    }
}

/** Pixel Fold / Galaxy Z Fold inner screen, unfolded in landscape: sidebar + list + note. */
class ScreenShotsUnfoldedLandscape : ScreenShotsBase() {
    @Config(qualifiers = "w841dp-h701dp-xhdpi")
    @Test fun unfoldedLandscape() {
        shoot("unfolded-landscape", "home")
        shoot("unfolded-landscape", "note") { putExtra(MainActivity.EXTRA_NOTE, "33333333-3333-4333-8333-333333333333") }
        shoot("unfolded-landscape", "database") { putExtra(MainActivity.EXTRA_NOTE, roadmap) }
    }
}

/** Home-screen widgets, rendered to RemoteViews the way the launcher shows them, at typical sizes. */
@OptIn(androidx.glance.appwidget.ExperimentalGlanceRemoteViewsApi::class)
class ScreenShotsWidgets : ScreenShotsBase() {
    private fun widget(name: String, width: Int, height: Int, content: @androidx.compose.runtime.Composable () -> Unit) {
        val ctx = ApplicationProvider.getApplicationContext<PliopadApp>()
        val views = runBlocking { androidx.glance.appwidget.GlanceRemoteViews().compose(ctx, androidx.compose.ui.unit.DpSize(width.dp, height.dp)) { content() } }.remoteViews
        val activity = org.robolectric.Robolectric.buildActivity(androidx.activity.ComponentActivity::class.java).setup().get()
        val frame = android.widget.FrameLayout(activity)
        frame.setBackgroundColor(0xFF6B7280.toInt())
        frame.setPadding(32, 32, 32, 32)
        val d = activity.resources.displayMetrics.density
        frame.addView(views.apply(activity, frame), android.widget.FrameLayout.LayoutParams((width * d).toInt(), (height * d).toInt()))
        activity.setContentView(frame)
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        frame.captureRoboImage(System.getProperty("shots.dir") + "/widgets/$name.png")
    }

    @Config(qualifiers = "w411dp-h891dp-xxhdpi")
    @Test fun widgets() {
        val app = ApplicationProvider.getApplicationContext<PliopadApp>()
        val today = LocalDate.now().toString()
        val (tasks, note, pinned, recent) = runBlocking {
            listOf(
                app.dao.notesWithTodosList(1).flatMap { Blocks.openTasks(it.id, it.title, Blocks.parse(it.content)) }.sortedWith(compareBy({ it.due == null }, { it.due })),
                app.dao.note("55555555-5555-4555-8555-555555555555"),
                app.dao.pinnedList(1),
                app.dao.recent(1, 12),
            )
        }
        @Suppress("UNCHECKED_CAST")
        val pinnedNotes = pinned as List<NoteEntity>
        @Suppress("UNCHECKED_CAST")
        val recentNotes = (recent as List<NoteEntity>).filter { r -> pinnedNotes.none { it.id == r.id } }
        widget("quick-capture-wide", 340, 80) { QuickContent(true) }
        widget("quick-capture-grid", 300, 170) { QuickContent(true) }
        @Suppress("UNCHECKED_CAST")
        widget("tasks", 300, 320) { TasksContent(true, tasks as List<Blocks.Task>, today) }
        widget("pinned-note", 300, 260) { NoteContent(note as NoteEntity?) }
        widget("shortcuts", 300, 320) { ShortcutsContent(true, pinnedNotes, recentNotes) }
        val graph = runBlocking { GraphModel.build(app.dao.allNotesList(1), maxNodes = 90) }
        widget("graph", 300, 220) { GraphContent(graph) }
    }
}

/** The static previews shown in the launcher's widget picker. */
class ScreenShotsWidgetPreviews : ScreenShotsBase() {
    @Config(qualifiers = "w411dp-h891dp-xxhdpi")
    @Test fun widgetPickerPreviews() {
        val activity = org.robolectric.Robolectric.buildActivity(androidx.activity.ComponentActivity::class.java).setup().get()
        val d = activity.resources.displayMetrics.density
        listOf("quick" to (300 to 90), "tasks" to (260 to 200), "note" to (240 to 200), "shortcuts" to (240 to 230), "graph" to (260 to 180)).forEach { (name, size) ->
            val frame = android.widget.FrameLayout(activity)
            frame.setBackgroundColor(0xFF6B7280.toInt())
            frame.setPadding(32, 32, 32, 32)
            val id = activity.resources.getIdentifier("widget_preview_$name", "layout", activity.packageName)
            val view = android.view.LayoutInflater.from(activity).inflate(id, frame, false)
            frame.addView(view, android.widget.FrameLayout.LayoutParams((size.first * d).toInt(), (size.second * d).toInt()))
            activity.setContentView(frame)
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            frame.captureRoboImage(System.getProperty("shots.dir") + "/widgets/preview-$name.png")
        }
    }
}

/** Inner screen held in portrait: drawer sidebar, list + note side by side. */
class ScreenShotsUnfoldedPortrait : ScreenShotsBase() {
    @Config(qualifiers = "w673dp-h841dp-xhdpi")
    @Test fun unfoldedPortrait() {
        shoot("unfolded-portrait", "home")
        shoot("unfolded-portrait", "note") { putExtra(MainActivity.EXTRA_NOTE, "33333333-3333-4333-8333-333333333333") }
    }
}
