package app.pliopad

import app.pliopad.work.Updates
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The update check compares versions numerically, not as text. */
class UpdatesTest {
    @Test fun comparesVersionsNumerically() {
        assertTrue(Updates.newer("1.10.0", "1.9.3"))
        assertTrue(Updates.newer("1.7.1", "1.7.0"))
        assertFalse(Updates.newer("1.7.0", "1.7.0"))
        assertFalse(Updates.newer("1.6.9", "1.7.0"))
    }
}
