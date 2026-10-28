package app.pliopad.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.lifecycle.lifecycleScope
import app.pliopad.PliopadApp
import app.pliopad.ui.PliopadTheme
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch

/** Shown when the "Pinned note" widget is added: pick the note it should show. Checklists are a good fit (groceries, today's plan). */
class NoteWidgetConfigActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val appWidgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // Backing out without choosing cancels adding the widget.
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
        val app = application as PliopadApp
        setContent {
            PliopadTheme {
                val session by app.session.data.collectAsState(initial = null)
                val ws = session?.wsId ?: 0
                val notes by remember(ws) { if (ws == 0L) flowOf(emptyList()) else app.dao.allForPicker(ws) }.collectAsState(initial = emptyList())
                var q by remember { mutableStateOf("") }
                // Notes with checklists first: they're the most useful on a home screen.
                val shown = notes.filter { it.title.contains(q.trim(), ignoreCase = true) }
                    .sortedWith(compareByDescending<app.pliopad.data.NoteEntity> { it.content.contains("\"t\":\"todo\"") }.thenByDescending { it.updatedAt })
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.systemBarsPadding().padding(16.dp)) {
                        Text("Pin a note to your home screen", style = MaterialTheme.typography.titleLarge)
                        Text(if (session?.signedIn == false) "Sign in to PlioPad first." else "Checklists can be ticked right on the widget.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
                        OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth(), placeholder = { Text("Search notes") }, singleLine = true)
                        LazyColumn(Modifier.padding(top = 8.dp)) {
                            items(shown, key = { it.id }) { n ->
                                Column(Modifier.fillMaxWidth().clickable {
                                    NoteWidgetPrefs.set(this@NoteWidgetConfigActivity, appWidgetId, n.id)
                                    lifecycleScope.launch {
                                        val glanceId = GlanceAppWidgetManager(this@NoteWidgetConfigActivity).getGlanceIdBy(appWidgetId)
                                        NoteWidget().update(this@NoteWidgetConfigActivity, glanceId)
                                        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
                                        finish()
                                    }
                                }.padding(vertical = 12.dp)) {
                                    Text("${n.icon ?: "📄"}  ${n.title.ifBlank { "Untitled" }}", fontWeight = FontWeight.Medium)
                                    if (n.plain.isNotBlank()) Text(n.plain.replace('\n', ' ').take(90), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                                        style = MaterialTheme.typography.bodySmall)
                                }
                                HorizontalDivider()
                            }
                        }
                    }
                }
            }
        }
    }
}
