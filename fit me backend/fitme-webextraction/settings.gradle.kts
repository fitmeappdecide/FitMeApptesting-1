rootProject.name = "FitMeWebExtraction"

// Shared, single-source-of-truth extraction engine.
// Lives at repo root (native/android-extraction-core) so it can also be included
// by fitme-ui's Android project (modules/fitme-extraction) without duplicating code.
include(":extraction-core")
project(":extraction-core").projectDir = file("../../native/android-extraction-core")

include(":app")
