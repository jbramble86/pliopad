package app.pliopad.scan

import android.app.Activity
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import app.pliopad.core.Block
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.tasks.await

/**
 * Document scanning with Google's on-device scanner (edge detection, perspective fix, cleanup), then on-device OCR so the
 * text of every scan is searchable on the phone, on the web and by "Ask your notes". Nothing leaves the phone until sync.
 */
object Scanner {
    private val options = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(true)
        .setPageLimit(20)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()

    @Composable
    fun rememberScanLauncher(onPages: (List<Uri>) -> Unit) =
        rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
            if (res.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
            val pages = GmsDocumentScanningResult.fromActivityResultIntent(res.data)?.pages?.map { it.imageUri }.orEmpty()
            if (pages.isNotEmpty()) onPages(pages)
        }

    suspend fun start(activity: Activity, launch: (IntentSenderRequest) -> Unit) {
        val sender = GmsDocumentScanning.getClient(options).getStartScanIntent(activity).await()
        launch(IntentSenderRequest.Builder(sender).build())
    }

    suspend fun recognize(ctx: Context, uri: Uri): String = runCatching {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).process(InputImage.fromFilePath(ctx, uri)).await().text
    }.getOrDefault("")

    /** Blocks for a scanned document: each page image, then the recognized text inside a collapsed toggle. */
    fun blocksFor(images: List<String>, text: String): List<Block> {
        val out = images.map { Block(t = "img", src = it) }.toMutableList()
        if (text.isNotBlank()) {
            out += Block(t = "toggle", x = "Text from scan")
            out += text.split("\n").filter { it.isNotBlank() }.map { Block(t = "p", x = it.trim(), ind = 1) }
        }
        return out
    }
}
