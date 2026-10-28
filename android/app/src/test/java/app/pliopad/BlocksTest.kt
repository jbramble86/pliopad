package app.pliopad

import app.pliopad.core.Block
import app.pliopad.core.Blocks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BlocksTest {
    @Test fun parsesServerJsonAndIgnoresUnknownFields() {
        val raw = """[{"id":"a","t":"todo","x":"Ship **it** @2026-11-03","c":true,"u":5,"future":1},{"id":"b","t":"p","x":"Hi","ind":2,"u":6}]"""
        val blocks = Blocks.parse(raw)
        assertEquals(2, blocks.size)
        assertTrue(blocks[0].checked)
        assertEquals(2, blocks[1].indent)
        // Round trip omits nulls, like the server does.
        assertTrue(!Blocks.encode(blocks).contains("null"))
    }

    @Test fun idsAndEditTimesSurviveARoundTrip() {
        // Encoding right after creating (same millisecond as the default) used to drop "u", so reading changed it.
        val raw = Blocks.encode(Blocks.fromMarkdown("# A\n- [ ] b\nc"))
        Thread.sleep(5)
        assertEquals(raw, Blocks.encode(Blocks.parse(raw)))
        assertTrue(raw.contains("\"u\":") && raw.contains("\"id\":"))
    }

    @Test fun plainTextStripsMarkup() {
        val b = listOf(Block(t = "p", x = "A **bold** and [link](https://x.com) and `code`"), Block(t = "hr"))
        assertEquals("A bold and link and code", Blocks.plain(b))
    }

    @Test fun markdownImport() {
        val b = Blocks.fromMarkdown("# Title\n- [x] done\n- [ ] todo\n  - nested\n1. one\n> quote\n```\ncode\n```")
        assertEquals(listOf("h1", "todo", "todo", "ul", "ol", "quote", "code"), b.map { it.t })
        assertTrue(b[1].checked)
        assertEquals(1, b[3].indent)
    }

    @Test fun shortcuts() {
        assertEquals("h2" to 3, Blocks.shortcut("## "))
        assertEquals("todo" to 3, Blocks.shortcut("[] "))
        assertNull(Blocks.shortcut("#hashtag"))
    }

    @Test fun tasksAndLinks() {
        val id = "0b9d1d5e-1111-4222-8333-444455556666"
        val b = listOf(Block(t = "todo", x = "Call Sam @2026-11-03"), Block(t = "todo", x = "Done", c = true), Block(t = "p", x = "see [X](note:$id)"))
        val tasks = Blocks.openTasks("n", "Note", b)
        assertEquals(1, tasks.size)
        assertEquals("2026-11-03", tasks[0].due)
        assertEquals(setOf(id), Blocks.links(b))
    }
}
