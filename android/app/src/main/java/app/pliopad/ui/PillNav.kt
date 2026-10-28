package app.pliopad.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * State shared between the floating pill bar (drawn above the screens) and the screens under it:
 * whether it's scrolled away, whether a drawer covers it, and what "+" does on the current screen.
 */
@Stable
class PillState {
    var scrolledAway by mutableStateOf(false)
    var drawerOpen by mutableStateOf(false)
    /** Set by the visible screen: create a note in its context (e.g. the open notebook). */
    var onNew: (() -> Unit)? by mutableStateOf(null)
    /** Set by the visible screen: the "more ways to create" menu (scan, voice, database…). */
    var onNewMenu: (() -> Unit)? by mutableStateOf(null)

    /** Scrolling down hides the bar; scrolling up brings it back. */
    val scroll = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (available.y < -6f) scrolledAway = true else if (available.y > 6f) scrolledAway = false
            return Offset.Zero
        }
    }
}

/** Null when the bar isn't used (unfolded screens use the permanent sidebar instead). */
val LocalPill = compositionLocalOf<PillState?> { null }

/** Space to leave under scrolling content so the last item isn't hidden by the bar. */
val PillClearance = 104.dp

enum class PillTab { Home, Notes, Tasks, Search, None }

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PillNav(
    visible: Boolean,
    current: PillTab,
    onHome: () -> Unit,
    onNotes: () -> Unit,
    onNew: () -> Unit,
    onNewMenu: (() -> Unit)?,
    onTasks: () -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = slideInVertically(tween(220)) { it * 2 } + fadeIn(tween(180)),
        exit = slideOutVertically(tween(200)) { it * 2 } + fadeOut(tween(160)),
    ) {
        Surface(
            modifier = Modifier.windowInsetsPadding(WindowInsets.navigationBars).padding(bottom = 14.dp),
            shape = RoundedCornerShape(32.dp),
            color = MaterialTheme.colorScheme.surface,
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            shadowElevation = 10.dp,
        ) {
            Row(Modifier.padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                PillItem(Icons.Default.Home, "Home", current == PillTab.Home, onHome)
                PillItem(Icons.AutoMirrored.Filled.Notes, "Notes", current == PillTab.Notes, onNotes)
                // The centre "+": tap for a new note here, long-press for scan, voice, database and templates.
                Box(
                    Modifier.padding(horizontal = 6.dp).size(52.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary)
                        .combinedClickable(
                            role = Role.Button, onClickLabel = "New note", onLongClickLabel = "More ways to create",
                            onClick = onNew,
                            onLongClick = onNewMenu?.let { menu -> { haptics.performHapticFeedback(HapticFeedbackType.LongPress); menu() } },
                        ),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Default.Add, "New note", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(28.dp)) }
                PillItem(Icons.Default.CheckBox, "Tasks", current == PillTab.Tasks, onTasks)
                PillItem(Icons.Default.Search, "Search", current == PillTab.Search, onSearch)
            }
        }
    }
}

/** One destination, always the same width so the bar never shifts: a filled capsule marks the current one. */
@Composable
private fun PillItem(icon: ImageVector, label: String, selected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Box(
        Modifier.width(56.dp).height(48.dp).clip(RoundedCornerShape(24.dp))
            .background(if (selected) cs.primaryContainer else androidx.compose.ui.graphics.Color.Transparent)
            .combinedClickable(role = Role.Tab, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, tint = if (selected) cs.onPrimaryContainer else cs.onSurfaceVariant, modifier = Modifier.size(24.dp))
    }
}
