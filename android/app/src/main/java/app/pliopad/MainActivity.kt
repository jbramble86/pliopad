package app.pliopad

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import app.pliopad.ui.LocalLayout
import app.pliopad.ui.currentLayout
import app.pliopad.ui.PliopadRoot
import app.pliopad.ui.PliopadTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/** What the UI should do next because of an intent (widget button, notification, share sheet). */
sealed interface Launch {
    data class OpenNote(val id: String) : Launch
    data object NewNote : Launch
    data object Scan : Launch
    data object Voice : Launch
    data object Daily : Launch
    data object Search : Launch
    data object Tasks : Launch
    data object Graph : Launch
}

class MainActivity : FragmentActivity() {
    val launches = MutableStateFlow<Launch?>(null)
    val locked = MutableStateFlow(false)
    private val hinge = mutableStateOf<Dp?>(null)
    private val tabletopTop = mutableStateOf<Dp?>(null)
    private var stoppedAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handle(intent)
        lifecycleScope.launch { if ((application as PliopadApp).session.current().appLock) locked.value = true }
        // Track the fold: a vertical hinge splits the panes; a horizontal half-open fold is tabletop (laptop) posture.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                WindowInfoTracker.getOrCreate(this@MainActivity).windowLayoutInfo(this@MainActivity).collect { info ->
                    val folds = info.displayFeatures.filterIsInstance<FoldingFeature>()
                    val density = resources.displayMetrics.density
                    hinge.value = folds.firstOrNull { it.orientation == FoldingFeature.Orientation.VERTICAL && (it.isSeparating || it.state == FoldingFeature.State.HALF_OPENED) }
                        ?.let { (it.bounds.centerX() / density).dp }
                    tabletopTop.value = folds.firstOrNull { it.orientation == FoldingFeature.Orientation.HORIZONTAL && it.state == FoldingFeature.State.HALF_OPENED }
                        ?.let { (it.bounds.top / density).dp }
                }
            }
        }
        setContent {
            PliopadTheme {
                CompositionLocalProvider(LocalLayout provides currentLayout(hinge.value, tabletopTop.value)) { PliopadRoot(this) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onStop() {
        super.onStop()
        stoppedAt = SystemClock.elapsedRealtime()
    }

    override fun onStart() {
        super.onStart()
        // App lock: ask again after 30 seconds in the background.
        if (stoppedAt > 0 && SystemClock.elapsedRealtime() - stoppedAt > 30_000) {
            lifecycleScope.launch { if ((application as PliopadApp).session.current().appLock) locked.value = true }
        }
    }

    fun unlock() {
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { locked.value = false }
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Unlock PlioPad").setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL).build())
    }

    private fun handle(i: Intent?) {
        i ?: return
        i.getStringExtra(EXTRA_NOTE)?.let { launches.value = Launch.OpenNote(it); return }
        when (i.getStringExtra(EXTRA_ACTION)) {
            "new" -> { launches.value = Launch.NewNote; return }
            "scan" -> { launches.value = Launch.Scan; return }
            "voice" -> { launches.value = Launch.Voice; return }
            "daily" -> { launches.value = Launch.Daily; return }
            "search" -> { launches.value = Launch.Search; return }
            "tasks" -> { launches.value = Launch.Tasks; return }
            "graph" -> { launches.value = Launch.Graph; return }
        }
        if (i.action == Intent.ACTION_SEND) {
            val app = application as PliopadApp
            val text = i.getStringExtra(Intent.EXTRA_TEXT)
            val subject = i.getStringExtra(Intent.EXTRA_SUBJECT)
            val image = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_STREAM)
            app.scope.launch {
                if (!app.session.current().signedIn) return@launch
                val id = app.repo.fromShare(text, subject, listOfNotNull(image))
                launches.value = Launch.OpenNote(id)
            }
            setIntent(Intent())
        }
    }

    companion object {
        const val EXTRA_NOTE = "pliopad.note"
        const val EXTRA_ACTION = "pliopad.action"
    }
}
