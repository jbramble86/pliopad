package app.pliopad

import android.app.Application
import app.pliopad.data.Api
import app.pliopad.data.PliopadDatabase
import app.pliopad.data.Repo
import app.pliopad.data.Session
import app.pliopad.data.SyncEngine
import app.pliopad.work.Reminders
import app.pliopad.work.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class PliopadApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val session by lazy { Session(this) }
    val database by lazy { PliopadDatabase.get(this) }
    val dao by lazy { database.dao() }
    private val sessionState by lazy { session.data.stateIn(scope, SharingStarted.Eagerly, app.pliopad.data.SessionData()) }
    /** Always pliopad.com in releases; tests point it at a local address. */
    var serverUrl: String = BuildConfig.SERVER_URL
    val api by lazy { Api(server = { serverUrl }, token = { sessionState.value.token }) }
    val sync by lazy { SyncEngine(dao, api) }
    val repo by lazy { Repo(this, dao, session) }

    override fun onCreate() {
        super.onCreate()
        Reminders.createChannel(this)
        scope.launch {
            sessionState // start collecting
            if (session.current().signedIn) runCatching { SyncWorker.schedulePeriodic(this@PliopadApp) }
        }
    }
}
