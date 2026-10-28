package app.pliopad.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One action in a bottom sheet. */
data class SheetAction(val label: String, val icon: ImageVector? = null, val emoji: String? = null, val danger: Boolean = false, val run: () -> Unit)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionSheet(title: String?, actions: List<SheetAction>, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp).verticalScroll(rememberScrollState())) {
            title?.let { Text(it, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) }
            actions.forEach { a ->
                Row(Modifier.fillMaxWidth().clickable { onDismiss(); a.run() }.padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    val color = if (a.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
                    when {
                        a.icon != null -> Icon(a.icon, null, tint = color)
                        a.emoji != null -> Text(a.emoji, fontSize = 18.sp, modifier = Modifier.width(24.dp))
                        else -> Box(Modifier.size(24.dp))
                    }
                    Text(a.label, color = color, modifier = Modifier.padding(start = 16.dp))
                }
            }
        }
    }
}

@Composable
fun PromptDialog(title: String, initial: String = "", label: String = "Name", ok: String = "Save", onDismiss: () -> Unit, onOk: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth().focusRequester(focus)) },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onDismiss(); onOk(text.trim()) }) { Text(ok) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

@Composable
fun ConfirmDialog(title: String, text: String, ok: String, danger: Boolean = false, onDismiss: () -> Unit, onOk: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(text) },
        confirmButton = { TextButton(onClick = { onDismiss(); onOk() }) { Text(ok, color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

private val EMOJI = "📄 📝 📓 📒 📕 📗 📘 📙 📚 🗂️ 📁 📌 🗒️ 📅 📊 📈 🧭 🗺️ 🚀 💡 ⭐ ✅ 🎯 🔥 ⚡ 🧠 💬 📣 🔖 🏷️ 🔒 🔑 🧪 🛠️ ⚙️ 💼 🏢 🏠 🌱 🌍 ✈️ 🍳 🎨 🎵 📷 🎬 💰 🧾 📦 🛒 ❤️ 👋 🙂 🤝 👥 🐛 🧩 🎓 🏆 📮 ☕ 📔".split(" ")

@Composable
fun EmojiDialog(onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Choose an icon") },
        text = {
            LazyVerticalGrid(GridCells.Adaptive(44.dp), Modifier.heightIn(max = 360.dp), contentPadding = PaddingValues(2.dp)) {
                items(EMOJI) { e -> Text(e, fontSize = 24.sp, modifier = Modifier.clickable { onDismiss(); onPick(e) }.padding(8.dp)) }
            }
        },
        confirmButton = { TextButton(onClick = { onDismiss(); onPick(null) }) { Text("Remove icon") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

/** Pick several items with checkboxes (e.g. notebooks to put into a stack). */
@Composable
fun <T> MultiPickDialog(title: String, items: List<T>, label: (T) -> String, sub: (T) -> String? = { null }, ok: String, onDismiss: () -> Unit, onOk: (List<T>) -> Unit) {
    val picked = remember { mutableStateListOf<T>() }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) },
        text = {
            if (items.isEmpty()) Text("There is nothing to add.")
            else Column(Modifier.verticalScroll(rememberScrollState())) {
                items.forEach { item ->
                    Row(Modifier.fillMaxWidth().clickable { if (item in picked) picked.remove(item) else picked.add(item) }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = item in picked, onCheckedChange = { if (it) picked.add(item) else picked.remove(item) })
                        Column {
                            Text(label(item))
                            sub(item)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = picked.isNotEmpty(), onClick = { onDismiss(); onOk(picked.toList()) }) { Text(ok) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

/** A drawer row that also reacts to a long press (for notebook, stack, tag and page actions). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun DrawerRow(
    label: String, leading: @Composable () -> Unit, selected: Boolean = false, indent: Int = 0, trailing: (@Composable () -> Unit)? = null,
    onLongClick: (() -> Unit)? = null, onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().padding(vertical = 1.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(if (selected) cs.primaryContainer else Color.Transparent)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(start = (12 + indent * 18).dp, end = 4.dp)
            .heightIn(min = 44.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) { leading() }
        Text(label, Modifier.weight(1f), maxLines = 1, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) cs.onPrimaryContainer else cs.onSurface)
        trailing?.invoke()
    }
}

@Composable
fun SectionHeader(label: String, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
    HorizontalDivider(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
}
