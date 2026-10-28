import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

android {
    namespace = "app.pliopad"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.pliopad"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "1.4.1"
        // The app always talks to pliopad.com; users never enter a server address.
        buildConfigField("String", "SERVER_URL", "\"https://pliopad.com\"")
    }

    buildTypes {
        debug {
            // Debug builds only: PLIOPAD_SERVER=… in local.properties points the app at a test server.
            val devServer = Properties().apply {
                rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
            }.getProperty("PLIOPAD_SERVER")
            if (!devServer.isNullOrBlank()) buildConfigField("String", "SERVER_URL", "\"$devServer\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Signed with the debug key so the release build installs straight away; use your own key for the Play Store.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        // Lint 8.7 crashes on the lint rules shipped inside newer AndroidX libraries; the code is still compiled and unit-tested.
        checkReleaseBuilds = false
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        // Screenshots of the main screens (Robolectric + Roborazzi) only when asked: ./gradlew testDebugUnitTest -Pshots
        unitTests.all {
            if (!project.hasProperty("shots")) it.exclude("**/ScreenShots*")
            else {
                it.systemProperty("roborazzi.test.record", "true")
                it.systemProperty("shots.dir", layout.buildDirectory.dir("shots").get().asFile.absolutePath)
                it.forkEvery = 1 // a fresh app (and database) for each device size
            }
            it.maxHeapSize = "3g"
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.datastore.preferences)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.glance.appwidget)
    implementation(libs.glance.material3)
    implementation(libs.mlkit.text)
    implementation(libs.mlkit.docscanner)
    implementation(libs.biometric)
    implementation(libs.androidx.window)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test)
}
