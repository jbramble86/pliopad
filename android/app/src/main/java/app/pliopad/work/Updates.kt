package app.pliopad.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.pliopad.BuildConfig
import app.pliopad.R
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * New versions of the app: checks pliopad.com every few hours (at start-up and from the background sync), shows a banner on Home,
 * and posts one notification per new version. The download is the APK the website offers.
 */
object Updates {
    @Serializable private data class Build(val id: String, val version: String? = null, val url: String? = null, val available: Boolean = false)
    data class Available(val version: String, val url: String)

    /** The newer version, if there is one (and it hasn't been dismissed). */
    val available = MutableStateFlow<Available?>(null)

    private const val CHANNEL = "updates"
    private const val EVERY = 6 * 3_600_000L
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("updates", Context.MODE_PRIVATE)

    /** True if [a] is a later version than [b] (1.10.0 > 1.9.3). */
    fun newer(a: String, b: String): Boolean {
        val x = a.split('.').map { it.toIntOrNull() ?: 0 }
        val y = b.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(x.size, y.size)) {
            val d = x.getOrElse(i) { 0 } - y.getOrElse(i) { 0 }
            if (d != 0) return d > 0
        }
        return false
    }

    /** Checks the website (at most every 6 hours unless [force]); safe to call from anywhere, never throws. */
    suspend fun check(ctx: Context, force: Boolean = false) {
        val p = prefs(ctx)
        if (!force && System.currentTimeMillis() - p.getLong("checked", 0) < EVERY) { restore(ctx); return }
        runCatching {
            val base = BuildConfig.SERVER_URL.trimEnd('/')
            val text = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                OkHttpClient().newCall(Request.Builder().url("$base/api/downloads").build()).execute().use { it.body?.string().orEmpty() }
            }
            val android = app.pliopad.core.Blocks.json.decodeFromString(ListSerializer(Build.serializer()), text).firstOrNull { it.id == "android" && it.available }
            p.edit().putLong("checked", System.currentTimeMillis()).apply()
            val v = android?.version
            if (v != null && android.url != null && newer(v, BuildConfig.VERSION_NAME)) {
                p.edit().putString("version", v).putString("url", base + android.url).apply()
                restore(ctx)
                notifyOnce(ctx, v, base + android.url)
            } else {
                p.edit().remove("version").remove("url").apply()
                available.value = null
            }
        }
    }

    private fun restore(ctx: Context) {
        val p = prefs(ctx)
        val v = p.getString("version", null)
        val url = p.getString("url", null)
        available.value = if (v != null && url != null && newer(v, BuildConfig.VERSION_NAME) && p.getString("dismissed", null) != v) Available(v, url) else null
    }

    /** Hides the banner for this version (a later one shows again). */
    fun dismiss(ctx: Context) {
        available.value?.let { prefs(ctx).edit().putString("dismissed", it.version).apply() }
        available.value = null
    }

    fun download(ctx: Context, a: Available) = ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(a.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

    private fun notifyOnce(ctx: Context, version: String, url: String) {
        val p = prefs(ctx)
        if (p.getString("notified", null) == version) return
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(ctx, 7001, Intent(Intent.ACTION_VIEW, Uri.parse(url)), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("PlioPad $version is available")
            .setContentText("Tap to download the update. Your notes stay on this phone.")
            .setContentIntent(open).setAutoCancel(true).build()
        NotificationManagerCompat.from(ctx).notify(7001, n)
        p.edit().putString("notified", version).apply()
    }
}
