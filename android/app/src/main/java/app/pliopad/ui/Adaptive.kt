package app.pliopad.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * How much room Pliopad has. The inner screen of a foldable is the main target:
 *  - compact  (< 600dp): phone or outer screen. One pane, the sidebar is a slide-out drawer.
 *  - medium   (600–839dp): unfolded in portrait, split screen. List + note side by side, drawer for the sidebar.
 *  - expanded (≥ 840dp): unfolded in landscape, tablets. Permanent sidebar + list + note, like the web app.
 *
 * [hingeDp] is where a vertical fold sits (from the left edge) when it splits the screen or the phone is half-open
 * like a book: panes line up with it so nothing sits in the crease.
 * [tabletop] is true when the phone is half-folded on a horizontal hinge (like a small laptop): the note goes on the
 * top half and the formatting bar on the bottom half.
 */
@Immutable
data class Layout(val widthDp: Int, val heightDp: Int, val hingeDp: Dp? = null, val tabletop: Boolean = false, val tabletopTopDp: Dp? = null) {
    val twoPane get() = widthDp >= 600
    val permanentSidebar get() = widthDp >= 840
    /** Columns for the Home dashboard's widgets. */
    val columns get() = when {
        widthDp >= 1100 -> 3
        widthDp >= 600 -> 2
        else -> 1
    }
    val sidebarWidth get() = 280.dp
}

val LocalLayout = staticCompositionLocalOf { Layout(400, 800) }

@Composable
fun currentLayout(hingeDp: Dp?, tabletopTopDp: Dp?): Layout {
    val c = LocalConfiguration.current
    return Layout(c.screenWidthDp, c.screenHeightDp, hingeDp, tabletopTopDp != null, tabletopTopDp)
}
