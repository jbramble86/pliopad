package app.pliopad.core

import kotlin.math.ln
import kotlin.math.sqrt

/**
 * Discovered links for PlioSphere: connections PlioPad finds on its own, beside the links people make with [[.
 * Signals, strongest first: one note mentions another's title; notes share tags; notes use the same distinctive
 * words (TF-IDF cosine similarity). Runs on the phone, offline. Same algorithm as the server's related.js.
 */
object Related {
    data class Doc(val id: String, val title: String, val text: String, val tags: List<String> = emptyList())
    data class Link(val a: String, val b: String, val score: Double, val why: String)

    private val STOP = ("a about above after again against all also am an and any are as at be because been before being below between both but by can " +
        "could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself " +
        "just let me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their " +
        "them then there these they this those through to too under until up very was we were what when where which while who whom why will with would " +
        "you your yours new note notes page pages todo done get got make made use used one two also via per etc yes okay ok").split(' ').toSet()
    private const val MAX_TERMS = 30
    private const val PER_NOTE = 3
    private const val MIN_SCORE = 0.22
    private val WORD = Regex("[a-zÀ-ɏ][a-zÀ-ɏ0-9'-]{2,}")

    private fun tokens(text: String) = WORD.findAll(text.lowercase()).map { it.value.removeSuffix("'s") }.filter { it !in STOP }.toList()

    private class Pair(val i: Int, val j: Int) { var score = 0.0; val words = mutableListOf<String>(); val why = mutableListOf<String>() }

    fun find(notes: List<Doc>, linked: Set<String> = emptySet(), tagNames: Map<String, String> = emptyMap()): List<Link> {
        val n = notes.size
        if (n < 2) return emptyList()
        val df = HashMap<String, Int>()
        val tfs = notes.map { d ->
            val tf = HashMap<String, Int>()
            tokens(d.title).forEach { tf[it] = (tf[it] ?: 0) + 3 }
            tokens(d.text.take(20000)).forEach { tf[it] = (tf[it] ?: 0) + 1 }
            tf.keys.forEach { df[it] = (df[it] ?: 0) + 1 }
            tf
        }
        val common = maxOf(3.0, n * 0.5)
        val vecs = tfs.map { tf ->
            val v = tf.map { (w, c) -> w to (1 + ln(c.toDouble())) * ln((n + 1.0) / ((df[w] ?: 1) + 0.5)) }
                .filter { (w, x) -> x > 0 && (df[w] ?: 0) < common }.sortedByDescending { it.second }.take(MAX_TERMS)
            val norm = sqrt(v.sumOf { it.second * it.second }).takeIf { it > 0 } ?: 1.0
            v.associate { (w, x) -> w to x / norm }
        }
        val postings = HashMap<String, MutableList<Int>>()
        vecs.forEachIndexed { i, v -> v.keys.forEach { postings.getOrPut(it) { mutableListOf() }.add(i) } }
        val pairs = HashMap<Long, Pair>()
        fun at(x: Int, y: Int): Pair { val i = minOf(x, y); val j = maxOf(x, y); return pairs.getOrPut(i.toLong() * 1_000_000 + j) { Pair(i, j) } }
        for ((w, list) in postings) {
            if (list.size > 60) continue
            for (x in list.indices) for (y in x + 1 until list.size) {
                val p = at(list[x], list[y]); p.score += vecs[list[x]].getValue(w) * vecs[list[y]].getValue(w); p.words += w
            }
        }
        val byTag = HashMap<String, MutableList<Int>>()
        notes.forEachIndexed { i, d -> d.tags.forEach { byTag.getOrPut(it) { mutableListOf() }.add(i) } }
        for ((t, list) in byTag) {
            if (list.size > 40) continue
            for (x in list.indices) for (y in x + 1 until list.size) { val p = at(list[x], list[y]); p.score += 0.35; p.why += "#" + (tagNames[t] ?: "tag") }
        }
        val titles = notes.mapIndexedNotNull { i, d -> d.title.trim().lowercase().takeIf { it.length >= 4 && tokens(it).isNotEmpty() }?.let { i to it } }
        notes.forEachIndexed { i, d ->
            val text = d.text.lowercase()
            if (text.isEmpty()) return@forEachIndexed
            for ((j, t) in titles) {
                if (j == i) continue
                val k = text.indexOf(t)
                if (k < 0) continue
                val before = text.getOrNull(k - 1); val after = text.getOrNull(k + t.length)
                if ((before != null && before.isLetterOrDigit()) || (after != null && after.isLetterOrDigit())) continue
                val p = at(i, j); p.score += 1.0; p.why.add(0, "Mentions “${notes[j].title}”")
            }
        }
        val best = HashMap<Int, MutableList<Pair>>()
        for (p in pairs.values) {
            if (p.score < MIN_SCORE) continue
            val a = notes[p.i].id; val b = notes[p.j].id
            if ("$a|$b" in linked || "$b|$a" in linked) continue
            best.getOrPut(p.i) { mutableListOf() }.add(p); best.getOrPut(p.j) { mutableListOf() }.add(p)
        }
        val keep = LinkedHashSet<Pair>()
        best.values.forEach { list -> list.sortedByDescending { it.score }.take(PER_NOTE).forEach { keep += it } }
        return keep.sortedByDescending { it.score }.map { p ->
            val words = p.words.sortedByDescending { vecs[p.i][it] ?: 0.0 }.take(3)
            Link(notes[p.i].id, notes[p.j].id, p.score, if (p.why.isNotEmpty()) p.why.take(2).joinToString(" · ") else "Similar: " + words.joinToString(", "))
        }
    }
}
