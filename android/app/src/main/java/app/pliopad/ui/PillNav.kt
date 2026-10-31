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
import dev.chrisbanes.haze.hazeEffect
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Column

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

}

/** Null when the bar isn't used (unfolded screens use the permanent sidebar instead). */
val LocalPill = compositionLocalOf<PillState?> { null }

/** Space to leave under scrolling content so the last item isn't hidden by the bar. */
val PillClearance = 96.dp

enum class PillTab { Home, Notes, Tasks, Search, None }

/**
 * The bottom navigation bar: full width, with the content scrolling behind it frosted (blurred) through the bar.
 * Home, Notes, a "+" in the middle (tap: new note here; long-press: scan, voice, database…), Tasks and Search.
 */
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
    haze: dev.chrisbanes.haze.HazeState,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val cs = MaterialTheme.colorScheme
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = slideInVertically(tween(200)) { it } + fadeIn(tween(160)),
        exit = slideOutVertically(tween(180)) { it } + fadeOut(tween(140)),
    ) {
        Column(
            Modifier.fillMaxWidth()
                .hazeEffect(haze, style = dev.chrisbanes.haze.HazeStyle(backgroundColor = cs.surface, tint = dev.chrisbanes.haze.HazeTint(cs.surface.copy(alpha = .62f)), blurRadius = 24.dp))
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(cs.outlineVariant.copy(alpha = .6f)))
            Row(Modifier.fillMaxWidth().height(60.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                NavItem(Icons.Default.Home, "Home", current == PillTab.Home, onHome)
                NavItem(Icons.AutoMirrored.Filled.Notes, "Notes", current == PillTab.Notes, onNotes)
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier.size(50.dp).clip(CircleShape).background(cs.primary)
                            .combinedClickable(
                                role = Role.Button, onClickLabel = "New note", onLongClickLabel = "More ways to create",
                                onClick = onNew,
                                onLongClick = onNewMenu?.let { menu -> { haptics.performHapticFeedback(HapticFeedbackType.LongPress); menu() } },
                            ),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Default.Add, "New note", tint = cs.onPrimary, modifier = Modifier.size(28.dp)) }
                }
                NavItem(Icons.Default.CheckBox, "Tasks", current == PillTab.Tasks, onTasks)
                NavItem(Icons.Default.Search, "Search", current == PillTab.Search, onSearch)
            }
        }
    }
}

/** One destination: an icon over a short label; a soft capsule behind the icon marks the current one. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun androidx.compose.foundation.layout.RowScope.NavItem(icon: ImageVector, label: String, selected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Column(
        Modifier.weight(1f).fillMaxHeight().combinedClickable(role = Role.Tab, onClickLabel = label, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.width(52.dp).height(26.dp).clip(RoundedCornerShape(13.dp)).background(if (selected) cs.primaryContainer else androidx.compose.ui.graphics.Color.Transparent),
            contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = if (selected) cs.onPrimaryContainer else cs.onSurfaceVariant, modifier = Modifier.size(22.dp))
        }
        Text(label, Modifier.padding(top = 1.dp), fontSize = 11.5.sp, lineHeight = 13.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            color = if (selected) cs.onSurface else cs.onSurfaceVariant)
    }
}
