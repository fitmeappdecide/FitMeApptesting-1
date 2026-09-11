// extraction-core
//
// SINGLE SOURCE OF TRUTH for the Android product-extraction engine.
// Consumed by:
//   1. fit me backend/fitme-webextraction/app  (standalone validation/demo app)
//   2. fitme-ui/modules/fitme-extraction/android (Expo native module used by the RN app)
//
// Do not copy these files elsewhere. Both consumers include this module directly via
// settings.gradle(.kts) `include(":extraction-core")` + a relative `projectDir`.
plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "com.fitme.webextraction"
    compileSdk = 34

    defaultConfig {
        minSdk = 21
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.20")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("androidx.core:core-ktx:1.12.0")
}
