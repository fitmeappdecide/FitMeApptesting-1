package com.fitme.webextraction.utils

import android.util.Log

/**
 * Simple wrapper around Android's Log class. Using a dedicated wrapper makes it easy to
 * change the logging backend later (e.g., to a file logger) without touching the core
 * code. All logs are emitted with the tag "FitMeWebExtract".
 */
object ExtractionLogger {
    private const val TAG = "FitMeWebExtract"

    var isEnabled: Boolean = true // Can be toggled via config if needed.

    fun d(message: String) = if (isEnabled) Log.d(TAG, message) else Unit
    fun i(message: String) = if (isEnabled) Log.i(TAG, message) else Unit
    fun w(message: String) = if (isEnabled) Log.w(TAG, message) else Unit
    fun e(message: String, throwable: Throwable? = null) {
        if (isEnabled) {
            throwable?.let { Log.e(TAG, message, it) } ?: Log.e(TAG, message)
        }
    }
}
