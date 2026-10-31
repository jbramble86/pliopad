package app.pliopad

import app.pliopad.core.Related
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** PlioSphere's discovered links: the same cases as the server's test, so both find the same connections. */
class RelatedTest {
    private val notes = listOf(
        Related.Doc("trip", "Trip to Lisbon", "Flights booked. Find a venue near Alfama for the team dinner, check the budget."),
        Related.Doc("dinner", "Team dinner", "Venue shortlist in Alfama, budget per head, dietary needs."),
        Related.Doc("plan", "Q4 plan", "Goals for the quarter. See the Trip to Lisbon for the offsite."),
        Related.Doc("gym", "Gym", "Squats, deadlifts, rows.", listOf("t1")),
        Related.Doc("run", "Running", "Intervals on Tuesday.", listOf("t1")),
        Related.Doc("linked", "Already linked", "Venue budget Alfama dinner"),
    )
    private val out = Related.find(notes, setOf("linked|dinner"), mapOf("t1" to "fitness"))
    private fun has(a: String, b: String) = out.firstOrNull { (it.a == a && it.b == b) || (it.a == b && it.b == a) }

    @Test fun similarWording() { assertNotNull(has("trip", "dinner")) }
    @Test fun mentions() { assertTrue(has("plan", "trip")!!.why.contains("Mentions “Trip to Lisbon”")) }
    @Test fun sharedTags() { assertTrue(has("gym", "run")!!.why.contains("#fitness")) }
    @Test fun skipsHandMadeLinksAndUnrelatedNotes() { assertFalse(has("linked", "dinner") != null); assertFalse(has("gym", "trip") != null) }
}
