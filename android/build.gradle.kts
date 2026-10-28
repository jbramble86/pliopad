plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
}

// Keep build output out of OneDrive (thousands of churning files) when building on Windows.
val localAppData: String? = System.getenv("LOCALAPPDATA")
if (localAppData != null) {
    allprojects {
        layout.buildDirectory.set(file("$localAppData/PliopadBuild/${project.name}"))
    }
}
