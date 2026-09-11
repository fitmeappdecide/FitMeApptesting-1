This module was moved to `../../../native/android-extraction-core` (repo root) so it can be
shared as a single source of truth between this standalone app and the fitme-ui Expo app.
See settings.gradle.kts — `:extraction-core` now points there.

Also removed: a stray, unwired, outdated draft of an Expo bridge module
(`src/main/java/com/fitme/extractionmodule/FitMeExtractionModule.kt`) that used an old/incompatible
expo-modules-kotlin API (`name()`/`function()` instead of `Name()`/`AsyncFunction()`) and was never
part of any active Gradle module here. The real, current, actively-used RN bridge lives at
`fitme-ui/modules/fitme-extraction/android/src/main/java/com/fitme/extraction/FitMeExtractionModule.kt`
and now calls into the shared `com.fitme.webextraction.facade.ExtractionFacade`.
