package app.pliopad.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// PlioPad brand: Midnight Navy, Periwinkle, Mint, Soft Ivory.
val Navy = Color(0xFF101D59)
val Periwinkle = Color(0xFF647BFF)
val PeriwinkleLight = Color(0xFF8C9DFF)
val Mint = Color(0xFF83EBC0)
val Ivory = Color(0xFFFAF9F5)

private val Light = lightColorScheme(
    primary = Periwinkle, onPrimary = Color.White, primaryContainer = Color(0xFFE3E8FF), onPrimaryContainer = Navy,
    secondary = Navy, onSecondary = Color.White, tertiary = Color(0xFF1D7A55), tertiaryContainer = Color(0xFFDDF8EC), onTertiaryContainer = Color(0xFF0B3D2A),
    background = Color.White, surface = Color.White, surfaceVariant = Color(0xFFF4F4F5), onSurfaceVariant = Color(0xFF52525B),
    outline = Color(0xFFD4D4D8), outlineVariant = Color(0xFFE4E4E7),
)
private val Dark = darkColorScheme(
    primary = PeriwinkleLight, onPrimary = Navy, primaryContainer = Color(0xFF293C91), onPrimaryContainer = Color(0xFFE3E8FF),
    secondary = Mint, onSecondary = Navy, tertiary = Mint, tertiaryContainer = Color(0xFF1F4A3B), onTertiaryContainer = Color(0xFFDDF8EC),
    background = Color(0xFF18181B), surface = Color(0xFF18181B), surfaceVariant = Color(0xFF27272A), onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF3F3F46), outlineVariant = Color(0xFF2E2E33),
)

@Composable
fun PliopadTheme(dynamic: Boolean = false, content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val ctx = LocalContext.current
    val scheme = when {
        dynamic && Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
