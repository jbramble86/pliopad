package app.pliopad.core

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.util.UUID

/**
 * A note is a flat list of blocks, in the same format as the server and web app:
 * t = type (p h1 h2 h3 todo ul ol quote callout code hr img file toggle page bookmark), x = text with light Markdown,
 * ind = indent, c = checked/open, u = last edit time (drives the block-level merge on the server).
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class Block(
    // Always written: their defaults are generated (a new id, "now"), so leaving them out would change them on the next read.
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val id: String = UUID.randomUUID().toString(),
    val t: String = "p",
    val x: String = "",
    val ind: Int? = null,
    val c: Boolean? = null,
    val lang: String? = null,
    val src: String? = null,
    val cap: String? = null,
    val col: String? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val u: Long = System.currentTimeMillis(),
) {
    val checked get() = c == true
    val indent get() = ind ?: 0
}

object Blocks {
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }

    val TEXT_TYPES = setOf("p", "h1", "h2", "h3", "todo", "ul", "ol", "quote", "callout", "toggle", "code")
    val KEEP_ON_ENTER = setOf("todo", "ul", "ol")

    fun parse(raw: String?): List<Block> =
        if (raw.isNullOrBlank()) emptyList() else runCatching { json.decodeFromString<List<Block>>(raw) }.getOrDefault(emptyList())

    fun encode(blocks: List<Block>): String = json.encodeToString(kotlinx.serialization.builtins.ListSerializer(Block.serializer()), blocks)

    private val link = Regex("""\[([^\]]*)]\([^)]*\)""")
    private val single = Regex("""(?<!\*)\*(?!\*)""")

    fun inlineToPlain(x: String): String = x.replace(link, "$1").replace("**", "").replace("~~", "").replace("`", "").replace(single, "")

    fun plain(blocks: List<Block>): String =
        blocks.filter { it.t != "hr" }.map { inlineToPlain(it.x) + (it.cap?.let { c -> " $c" } ?: "") }.filter { it.isNotBlank() }.joinToString("\n")

    fun snippet(blocks: List<Block>, max: Int = 160): String = plain(blocks).replace('\n', ' ').let { if (it.length > max) it.take(max - 1) + "…" else it }

    /** Markdown-ish text (pasted, shared or typed) to blocks. */
    fun fromMarkdown(md: String): List<Block> {
        val out = mutableListOf<Block>()
        var code: MutableList<String>? = null
        for (line in md.replace("\r", "").split('\n')) {
            if (code != null) {
                if (line.trimStart().startsWith("```")) { out += Block(t = "code", x = code.joinToString("\n")); code = null } else code += line
                continue
            }
            if (line.trimStart().startsWith("```")) { code = mutableListOf(); continue }
            if (line.isBlank()) continue
            val ind = ((line.length - line.trimStart().length) / 2).coerceAtMost(8).takeIf { it > 0 }
            val t = line.trim()
            out += when {
                t.startsWith("### ") -> Block(t = "h3", x = t.drop(4))
                t.startsWith("## ") -> Block(t = "h2", x = t.drop(3))
                t.startsWith("# ") -> Block(t = "h1", x = t.drop(2))
                Regex("""^[-*+]\s+\[([ xX])]\s*(.*)$""").find(t) != null -> Regex("""^[-*+]\s+\[([ xX])]\s*(.*)$""").find(t)!!.let {
                    Block(t = "todo", x = it.groupValues[2], c = if (it.groupValues[1].isNotBlank()) true else null, ind = ind)
                }
                Regex("""^[-*+•]\s+(.*)$""").find(t) != null -> Block(t = "ul", x = Regex("""^[-*+•]\s+(.*)$""").find(t)!!.groupValues[1], ind = ind)
                Regex("""^\d+[.)]\s+(.*)$""").find(t) != null -> Block(t = "ol", x = Regex("""^\d+[.)]\s+(.*)$""").find(t)!!.groupValues[1], ind = ind)
                t.startsWith("> ") -> Block(t = "quote", x = t.drop(2))
                t == "---" -> Block(t = "hr")
                else -> Block(t = "p", x = t, ind = ind)
            }
        }
        code?.let { out += Block(t = "code", x = it.joinToString("\n")) }
        return out
    }

    /** Markdown shortcut typed at the start of a text block: returns the new type and the prefix length, or null. */
    fun shortcut(text: String): Pair<String, Int>? {
        val rules = listOf("### " to "h3", "## " to "h2", "# " to "h1", "- " to "ul", "* " to "ul", "1. " to "ol", "[] " to "todo",
            "[ ] " to "todo", "> " to "quote", "```" to "code", "! " to "callout")
        for ((prefix, type) in rules) if (text.startsWith(prefix)) return type to prefix.length
        return null
    }

    data class Task(val noteId: String, val noteTitle: String, val blockId: String, val text: String, val due: String?)

    private val dueRe = Regex("""@(\d{4}-\d{2}-\d{2})""")

    fun openTasks(noteId: String, title: String, blocks: List<Block>): List<Task> =
        blocks.filter { it.t == "todo" && !it.checked && it.x.isNotBlank() }
            .map { Task(noteId, title, it.id, inlineToPlain(it.x), dueRe.find(it.x)?.groupValues?.get(1)) }

    /** Note ids linked from this content ([Title](note:ID) and child-page blocks). */
    fun links(blocks: List<Block>): Set<String> {
        val re = Regex("""\(note:([0-9a-f-]{36})\)""")
        return blocks.flatMap { b -> re.findAll(b.x).map { it.groupValues[1] }.toList() + listOfNotNull(b.src.takeIf { b.t == "page" }) }.toSet()
    }
}
