package app.pliopad.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.pliopad.PliopadApp
import app.pliopad.MainActivity
import app.pliopad.R
import app.pliopad.data.ApiException
import app.pliopad.widget.Widgets
import java.util.concurrent.TimeUnit

/** Background sync: every 15 minutes, and a few seconds after any local edit. Only runs with a network connection. */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as PliopadApp
        val s = app.session.current()
        if (!s.signedIn) return Result.success()
        return try {
            for (ws in s.workspaces) if (ws.id == s.wsId || s.workspaces.size == 1) app.sync.run(ws.id)
            Reminders.scheduleAll(applicationContext, app.dao.upcomingReminders(s.wsId, System.currentTimeMillis()).map { Triple(it.id, it.title, it.reminderAt!!) })
            Widgets.refreshNow(applicationContext)
            Result.success()
        } catch (e: ApiException) {
            if (e.status == 401) Result.failure() else Result.retry()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedulePeriodic(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build())
        }

        /** Debounced: each edit pushes the run back, so typing does not trigger a sync per keystroke. */
        fun requestSoon(ctx: Context, delaySec: Long = 4) {
            WorkManager.getInstance(ctx).enqueueUniqueWork("sync-now", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).setInitialDelay(delaySec, TimeUnit.SECONDS).build())
        }
    }
}

/** Note reminders, shown as local notifications even when the phone is offline. */
object Reminders {
    const val CHANNEL = "reminders"

    fun createChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
    }

    fun scheduleAll(ctx: Context, items: List<Triple<String, String, Long>>) {
        val wm = WorkManager.getInstance(ctx)
        for ((id, title, at) in items) {
            val delay = at - System.currentTimeMillis()
            if (delay <= 0) continue
            wm.enqueueUniqueWork("reminder-$id", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<ReminderWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS)
                    .setInputData(workDataOf("id" to id, "title" to title, "at" to at)).build())
        }
    }

    fun cancel(ctx: Context, id: String) = WorkManager.getInstance(ctx).cancelUniqueWork("reminder-$id")
}

class ReminderWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString("id") ?: return Result.success()
        val note = (applicationContext as PliopadApp).dao.note(id)
        if (note == null || note.reminderDone || note.trashedAt != null || note.reminderAt != inputData.getLong("at", 0)) return Result.success()
        if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return Result.success()
        val open = PendingIntent.getActivity(applicationContext, id.hashCode(),
            Intent(applicationContext, MainActivity::class.java).putExtra(MainActivity.EXTRA_NOTE, id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(applicationContext, Reminders.CHANNEL)
            .setSmallIcon(R.drawable.ic_notification).setContentTitle(note.title.ifBlank { "Untitled" }).setContentText("Reminder")
            .setContentIntent(open).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        NotificationManagerCompat.from(applicationContext).notify(id.hashCode(), n)
        return Result.success()
    }
}
