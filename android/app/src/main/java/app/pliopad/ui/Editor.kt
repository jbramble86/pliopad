package app.pliopad.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.FormatIndentDecrease
import androidx.compose.material.icons.automirrored.filled.FormatIndentIncrease
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.pliopad.core.Block
import app.pliopad.core.Blocks
import coil.compose.AsyncImage
import java.io.File
import java.time.LocalDate

/** Zero-width space at the start of every field: when it disappears, the person pressed backspace at the start of a block. */
private const val ZW = "​"

/** Editing state: the blocks, their text fields, and which block should take focus next. */
class EditorState(initial: List<Block>) {
    val blocks = mutableStateListOf<Block>().apply { addAll(initial.ifEmpty { listOf(Block()) }) }
    val fields = mutableStateMapOf<String, TextFieldValue>()
    var focusId by mutableStateOf<String?>(null)
    var pendingFocus by mutableStateOf<Pair<String, Int>?>(null)
    var version by mutableStateOf(0) // bumps on every change, so the screen knows to save
    /** Set when "[[" is typed: the block and where the "[[" starts. The screen shows a page picker. */
    var linkTrigger by mutableStateOf<Pair<String, Int>?>(null)

    /** The blocks to save. The blank paragraph an empty note shows for typing doesn't count, so opening a note never changes it. */
    fun content(): List<Block> = blocks.toList().let { if (it.size == 1 && it[0].t == "p" && it[0].x.isEmpty()) emptyList() else it }

    fun field(b: Block): TextFieldValue = fields.getOrPut(b.id) { TextFieldValue(ZW + b.x, TextRange(ZW.length + b.x.length)) }

    fun replaceAll(next: List<Block>) {
        val keep = focusId
        blocks.clear(); blocks.addAll(next.ifEmpty { listOf(Block()) })
        fields.clear()
        keep?.let { id -> blocks.firstOrNull { it.id == id }?.let { pendingFocus = id to (field(it).selection.start - 1).coerceAtLeast(0) } }
    }

    private fun idx(id: String) = blocks.indexOfFirst { it.id == id }
    private fun touch(b: Block) = b.copy(u = System.currentTimeMillis())
    private fun setText(i: Int, x: String, cursor: Int) {
        blocks[i] = touch(blocks[i].copy(x = x))
        fields[blocks[i].id] = TextFieldValue(ZW + x, TextRange(ZW.length + cursor))
        version++
    }
    private fun focus(id: String, cursor: Int) { pendingFocus = id to cursor }

    fun onChange(id: String, v: TextFieldValue) {
        val i = idx(id).takeIf { it >= 0 } ?: return
        val b = blocks[i]
        if (!v.text.startsWith(ZW)) return backspaceAtStart(i)
        val raw = v.text.removePrefix(ZW)
        val cursor = (v.selection.start - ZW.length).coerceAtLeast(0)
        if (b.t != "code" && raw.contains('\n')) return split(i, raw, raw.indexOf('\n'))
        if (b.t == "p") {
            Blocks.shortcut(raw)?.let { (type, len) ->
                if (cursor == len) {
                    blocks[i] = touch(b.copy(t = type, x = raw.drop(len), c = null))
                    fields[b.id] = TextFieldValue(ZW + raw.drop(len), TextRange(ZW.length))
                    version++
                    return
                }
            }
        }
        if (raw == b.x) { fields[id] = v; return } // only the selection moved
        blocks[i] = touch(b.copy(x = raw))
        fields[id] = v
        version++
        if (b.t != "code" && cursor >= 2 && raw.regionMatches(cursor - 2, "[[", 0, 2) && raw.length > b.x.length) linkTrigger = id to cursor - 2
    }

    /** Replaces the typed "[[" with a link to another page. */
    fun insertLink(noteId: String, title: String) {
        val (id, at) = linkTrigger ?: (focusId?.let { f -> f to (field(blocks[idx(f)]).selection.start - ZW.length) } ?: return)
        linkTrigger = null
        val i = idx(id).takeIf { it >= 0 } ?: return
        val x = blocks[i].x
        val start = at.coerceIn(0, x.length)
        val end = if (x.regionMatches(start, "[[", 0, 2)) start + 2 else start
        val link = "[${title.replace("]", "")}](note:$noteId) "
        setText(i, x.substring(0, start) + link + x.substring(end), start + link.length)
        focus(id, start + link.length)
    }

    /** Wraps the selection in Markdown markers (or inserts a pair to type into). */
    fun wrapSelection(marker: String) {
        val id = focusId ?: return
        val i = idx(id).takeIf { it >= 0 } ?: return
        val f = field(blocks[i])
        val x = blocks[i].x
        val s = (f.selection.min - ZW.length).coerceIn(0, x.length)
        val e = (f.selection.max - ZW.length).coerceIn(0, x.length)
        val inner = x.substring(s, e)
        val next = x.substring(0, s) + marker + inner + marker + x.substring(e)
        setText(i, next, s + marker.length + inner.length)
        focus(id, if (inner.isEmpty()) s + marker.length else s + 2 * marker.length + inner.length)
    }

    private fun split(i: Int, raw: String, at: Int) {
        val b = blocks[i]
        val before = raw.substring(0, at)
        val after = raw.substring(at + 1)
        if (before.isBlank() && after.isBlank() && b.t != "p") { // Enter on an empty list item leaves the list
            blocks[i] = touch(if (b.indent > 0) b.copy(ind = (b.indent - 1).takeIf { it > 0 }) else b.copy(t = "p", c = null))
            setText(i, "", 0)
            return focus(b.id, 0)
        }
        val type = if (b.t in Blocks.KEEP_ON_ENTER) b.t else "p"
        val next = Block(t = type, x = after, ind = b.ind)
        setText(i, before, before.length)
        blocks.add(i + 1, next)
        focus(next.id, 0)
    }

    private fun backspaceAtStart(i: Int) {
        val b = blocks[i]
        when {
            b.t != "p" && b.t != "code" -> { blocks[i] = touch(b.copy(t = "p", c = null)); setText(i, b.x, 0); focus(b.id, 0) }
            b.indent > 0 -> { blocks[i] = touch(b.copy(ind = (b.indent - 1).takeIf { it > 0 })); setText(i, b.x, 0); focus(b.id, 0) }
            i == 0 -> setText(i, b.x, 0)
            else -> {
                val prev = blocks[i - 1]
                if (prev.t !in Blocks.TEXT_TYPES) { blocks.removeAt(i - 1); version++; setText(i - 1, b.x, 0); return focus(b.id, 0) }
                val join = prev.x.length
                blocks.removeAt(i)
                fields.remove(b.id)
                setText(i - 1, prev.x + b.x, join)
                focus(prev.id, join)
            }
        }
    }

    fun setType(type: String) {
        val i = focusId?.let { idx(it) }?.takeIf { it >= 0 } ?: return
        val b = blocks[i]
        blocks[i] = touch(b.copy(t = if (b.t == type) "p" else type, c = if (type == "toggle") true else null))
        version++
        focus(b.id, field(b).selection.start - ZW.length)
    }

    fun indent(delta: Int) {
        val i = focusId?.let { idx(it) }?.takeIf { it >= 0 } ?: return
        val b = blocks[i]
        val max = if (i == 0) 0 else blocks[i - 1].indent + 1
        blocks[i] = touch(b.copy(ind = (b.indent + delta).coerceIn(0, max.coerceAtMost(8)).takeIf { it > 0 }))
        version++
        focus(b.id, field(b).selection.start - ZW.length)
    }

    fun toggleCheck(id: String) {
        val i = idx(id).takeIf { it >= 0 } ?: return
        blocks[i] = touch(blocks[i].let { it.copy(c = if (it.checked) null else true) })
        version++
    }

    fun remove(id: String) {
        val i = idx(id).takeIf { it >= 0 } ?: return
        blocks.removeAt(i)
        if (blocks.isEmpty()) blocks.add(Block())
        version++
    }

    fun insertText(text: String) {
        val id = focusId ?: return
        val i = idx(id).takeIf { it >= 0 } ?: return
        val f = field(blocks[i])
        val at = (f.selection.start - ZW.length).coerceIn(0, blocks[i].x.length)
        val x = blocks[i].x.substring(0, at) + text + blocks[i].x.substring(at)
        setText(i, x, at + text.length)
        focus(id, at + text.length)
    }

    /** Inserts blocks after the focused block (or at the end); an empty focused paragraph is replaced. */
    fun insertBlocks(list: List<Block>) {
        if (list.isEmpty()) return
        val i = focusId?.let { idx(it) }?.takeIf { it >= 0 } ?: (blocks.size - 1)
        val cur = blocks.getOrNull(i)
        if (cur != null && cur.t == "p" && cur.x.isBlank()) { blocks.removeAt(i); blocks.addAll(i, list) } else blocks.addAll(i + 1, list)
        version++
        list.lastOrNull { it.t in Blocks.TEXT_TYPES }?.let { focus(it.id, it.x.length) }
    }

    /** A tap on blank space in the note: put the cursor at the end, adding a paragraph if the note ends in an image, divider or page. */
    fun focusEnd() {
        val last = blocks.lastOrNull()
        if (last != null && last.t in Blocks.TEXT_TYPES) return focus(last.id, last.x.length)
        val b = Block()
        blocks.add(b)
        focus(b.id, 0)
    }
}

@Composable
fun BlockEditor(
    state: EditorState,
    readOnly: Boolean,
    noteTitle: (String) -> String?,
    openNote: (String) -> Unit,
    openUrl: (String) -> Unit,
) {
    val requesters = remember { mutableMapOf<String, FocusRequester>() }
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    LaunchedEffect(state.pendingFocus) {
        val (id, cursor) = state.pendingFocus ?: return@LaunchedEffect
        val b = state.blocks.firstOrNull { it.id == id } ?: return@LaunchedEffect
        state.fields[id] = TextFieldValue(ZW + b.x, TextRange(ZW.length + cursor.coerceIn(0, b.x.length)))
        runCatching { requesters[id]?.requestFocus() }
        keyboard?.show()
        state.pendingFocus = null
    }
    var olCount = IntArray(9)
    var hideBelow: Int? = null
    Column(Modifier.fillMaxWidth()) {
        state.blocks.forEachIndexed { _, b ->
            val ind = b.indent
            if (hideBelow != null && ind <= hideBelow!!) hideBelow = null
            for (k in ind + 1 until olCount.size) olCount[k] = 0
            olCount[ind] = if (b.t == "ol") olCount[ind] + 1 else 0
            val hidden = hideBelow != null
            if (b.t == "toggle" && !b.checked && hideBelow == null) hideBelow = ind
            if (hidden) return@forEachIndexed
            val fr = requesters.getOrPut(b.id) { FocusRequester() }
            BlockRow(state, b, olCount[ind], readOnly, fr, noteTitle, openNote, openUrl)
        }
    }
}

@Composable
private fun BlockRow(
    state: EditorState, b: Block, olNum: Int, readOnly: Boolean, fr: FocusRequester,
    noteTitle: (String) -> String?, openNote: (String) -> Unit, openUrl: (String) -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val style = when (b.t) {
        "h1" -> TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Bold, lineHeight = 32.sp)
        "h2" -> TextStyle(fontSize = 21.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp)
        "h3" -> TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold, lineHeight = 24.sp)
        "code" -> TextStyle(fontSize = 13.sp, fontFamily = FontFamily.Monospace, lineHeight = 20.sp)
        else -> TextStyle(fontSize = 16.sp, lineHeight = 24.sp)
    }.merge(TextStyle(color = if (b.t == "todo" && b.checked) cs.onSurfaceVariant else cs.onSurface,
        textDecoration = if (b.t == "todo" && b.checked) TextDecoration.LineThrough else null))
    val top = when (b.t) { "h1" -> 14.dp; "h2" -> 10.dp; "h3" -> 6.dp; else -> 1.dp }
    val rowMod = Modifier.fillMaxWidth().padding(start = (b.indent * 22).dp, top = top, bottom = 1.dp).let {
        when (b.t) {
            "callout" -> it.background(cs.surfaceVariant, RoundedCornerShape(8.dp)).padding(8.dp)
            "quote" -> it.padding(start = 2.dp)
            "code" -> it.background(cs.surfaceVariant, RoundedCornerShape(8.dp)).padding(10.dp)
            else -> it
        }
    }
    when (b.t) {
        "hr" -> { HorizontalDivider(Modifier.padding(vertical = 12.dp)); return }
        "img" -> {
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                val model: Any? = b.src?.let { if (it.startsWith("local:")) File(it.removePrefix("local:")) else it }
                AsyncImage(model = model, contentDescription = b.cap, contentScale = ContentScale.FillWidth,
                    modifier = Modifier.fillMaxWidth().background(cs.surfaceVariant, RoundedCornerShape(8.dp)))
                if (!b.cap.isNullOrBlank()) Text(b.cap, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                if (!readOnly) TextButton(onClick = { state.remove(b.id) }) { Icon(Icons.Default.DeleteOutline, null, Modifier.size(16.dp)); Text(" Remove image") }
            }
            return
        }
        "file", "bookmark", "page" -> {
            val label = when (b.t) { "page" -> "📄  " + (b.src?.let(noteTitle) ?: b.x.ifBlank { "Untitled" }); "file" -> "📎  " + (b.cap ?: "Attachment"); else -> "🔗  " + b.x.ifBlank { b.src ?: "" } }
            Surface(shape = RoundedCornerShape(8.dp), color = cs.surface, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
                .border(1.dp, cs.outlineVariant, RoundedCornerShape(8.dp))
                .clickable { if (b.t == "page") b.src?.let(openNote) else b.src?.let(openUrl) }) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(label, Modifier.weight(1f), maxLines = 1)
                    if (b.t == "bookmark") Icon(Icons.Default.Link, null, tint = cs.onSurfaceVariant)
                }
            }
            return
        }
    }
    Row(rowMod, verticalAlignment = Alignment.Top) {
        // Gutter: checkbox, bullet, number, toggle arrow, callout icon or quote bar.
        when (b.t) {
            "todo" -> Checkbox(checked = b.checked, onCheckedChange = { state.toggleCheck(b.id) }, modifier = Modifier.size(24.dp).padding(end = 6.dp),
                colors = CheckboxDefaults.colors(checkedColor = cs.primary))
            "ul" -> Text(if (b.indent % 2 == 0) "•" else "◦", Modifier.width(22.dp), style = style, color = cs.onSurfaceVariant)
            "ol" -> Text("$olNum.", Modifier.widthIn(min = 22.dp).padding(end = 4.dp), style = style, color = cs.onSurfaceVariant)
            "toggle" -> Icon(if (b.checked) Icons.Default.ExpandMore else Icons.Default.ChevronRight, null,
                Modifier.size(24.dp).clickable { state.toggleCheck(b.id) }, tint = cs.onSurfaceVariant)
            "callout" -> Text(b.src ?: "💡", Modifier.padding(end = 8.dp), fontSize = 18.sp)
            "quote" -> Box(Modifier.padding(vertical = 2.dp).size(3.dp, 22.dp).background(cs.onSurface))
        }
        if (b.t == "quote") Box(Modifier.width(10.dp))
        BasicTextField(
            value = state.field(b),
            onValueChange = { state.onChange(b.id, it) },
            readOnly = readOnly,
            textStyle = style,
            cursorBrush = SolidColor(cs.primary),
            visualTransformation = if (b.t == "code") VisualTransformation.None else MarkdownStyle(cs.primary, cs.onSurfaceVariant, cs.surfaceVariant),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.weight(1f).focusRequester(fr).onFocusChanged { if (it.isFocused) state.focusId = b.id },
            decorationBox = { inner ->
                Box {
                    if (b.x.isEmpty() && state.focusId == b.id && b.t == "p") Text("Write, or use the toolbar below", style = style.copy(color = cs.onSurfaceVariant.copy(alpha = .6f)))
                    else if (b.x.isEmpty() && b.t != "p") Text(placeholder(b.t), style = style.copy(color = cs.onSurfaceVariant.copy(alpha = .5f)))
                    inner()
                }
            },
        )
    }
}

private fun placeholder(t: String) = when (t) { "h1" -> "Heading 1"; "h2" -> "Heading 2"; "h3" -> "Heading 3"; "todo" -> "To-do"; "toggle" -> "Toggle"; "quote" -> "Quote"; "code" -> "Code"; else -> "List" }

/** Styles **bold**, *italic*, `code`, ~~strike~~, links and @dates in place while keeping the raw characters editable. */
private class MarkdownStyle(val accent: Color, val dim: Color, val codeBg: Color) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val s = text.text
        val out = buildAnnotatedString {
            append(s)
            fun mark(re: Regex, span: SpanStyle, markers: Int) = re.findAll(s).forEach { m ->
                addStyle(span, m.range.first, m.range.last + 1)
                if (markers > 0) {
                    addStyle(SpanStyle(color = dim.copy(alpha = .45f)), m.range.first, m.range.first + markers)
                    addStyle(SpanStyle(color = dim.copy(alpha = .45f)), m.range.last + 1 - markers, m.range.last + 1)
                }
            }
            mark(Regex("""\*\*[^*]+\*\*"""), SpanStyle(fontWeight = FontWeight.Bold), 2)
            mark(Regex("""(?<![*\w])\*[^*\n]+\*(?![*\w])"""), SpanStyle(fontStyle = FontStyle.Italic), 1)
            mark(Regex("""~~[^~]+~~"""), SpanStyle(textDecoration = TextDecoration.LineThrough), 2)
            mark(Regex("""`[^`]+`"""), SpanStyle(fontFamily = FontFamily.Monospace, background = codeBg), 1)
            Regex("""\[([^\]]*)]\(([^)]*)\)""").findAll(s).forEach { m ->
                val label = m.groups[1]!!.range
                addStyle(SpanStyle(color = accent, textDecoration = TextDecoration.Underline), label.first, label.last + 1)
                addStyle(SpanStyle(color = dim.copy(alpha = .4f), fontSize = 11.sp), label.last + 2, m.range.last + 1)
            }
            Regex("""@\d{4}-\d{2}-\d{2}""").findAll(s).forEach { addStyle(SpanStyle(color = Color(0xFFC2410C), background = Color(0x22F97316)), it.range.first, it.range.last + 1) }
        }
        return TransformedText(out, OffsetMapping.Identity)
    }
}

/** Formatting bar shown above the keyboard while editing. */
@Composable
fun EditorToolbar(state: EditorState, onInsert: () -> Unit, onImage: () -> Unit, onScan: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val current = state.blocks.firstOrNull { it.id == state.focusId }?.t
    Surface(color = cs.surface, tonalElevation = 3.dp, shadowElevation = 6.dp) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(0.dp),
            verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onInsert) { Text("+ Insert", fontWeight = FontWeight.SemiBold, color = cs.primary) }
            TextButton(onClick = { state.wrapSelection("**") }, modifier = Modifier.widthIn(min = 40.dp)) { Text("B", fontWeight = FontWeight.ExtraBold, color = cs.onSurface) }
            TextButton(onClick = { state.wrapSelection("*") }, modifier = Modifier.widthIn(min = 40.dp)) { Text("I", fontStyle = FontStyle.Italic, color = cs.onSurface) }
            TextButton(onClick = { state.wrapSelection("~~") }, modifier = Modifier.widthIn(min = 40.dp)) { Text("S", textDecoration = TextDecoration.LineThrough, color = cs.onSurface) }
            TextButton(onClick = { state.wrapSelection("`") }, modifier = Modifier.widthIn(min = 40.dp)) { Text("</>", fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = cs.onSurface) }
            listOf("h1" to "H1", "h2" to "H2", "h3" to "H3", "todo" to "☑", "ul" to "•", "ol" to "1.", "toggle" to "▸", "quote" to "❝", "callout" to "💡", "code" to "{ }").forEach { (t, label) ->
                TextButton(onClick = { state.setType(t) }, modifier = Modifier.widthIn(min = 44.dp)) {
                    Text(label, fontWeight = if (current == t) FontWeight.Bold else FontWeight.Normal, color = if (current == t) cs.primary else cs.onSurface)
                }
            }
            IconButton(onClick = { state.indent(-1) }) { Icon(Icons.AutoMirrored.Filled.FormatIndentDecrease, "Outdent") }
            IconButton(onClick = { state.indent(1) }) { Icon(Icons.AutoMirrored.Filled.FormatIndentIncrease, "Indent") }
            IconButton(onClick = { state.insertText("@" + LocalDate.now() + " ") }) { Icon(Icons.Default.CalendarToday, "Insert today's date") }
            IconButton(onClick = onImage) { Icon(Icons.Default.Image, "Add image") }
            IconButton(onClick = onScan) { Icon(Icons.Default.DocumentScanner, "Scan document") }
        }
    }
}
