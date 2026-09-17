package com.fitme.extraction

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import com.fitme.webextraction.facade.ExtractionFacade
import com.fitme.webextraction.facade.ExtractionFacade.ExtractionListener
import com.fitme.webextraction.facade.ExtractionFacade.ExtractedProduct
import com.fitme.webextraction.errors.ExtractionError

class FitMeExtractionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FitMeExtraction")

    Events("extractionProgress")

    AsyncFunction("extractProduct") { url: String, promise: Promise ->
      val context = appContext.reactContext ?: throw Exception("React context is null")

      // ExtractionFacade.extract returns a Job, but it executes on Main thread internally.
      // We pass a listener to bridge results back to the promise and events.
      ExtractionFacade.extract(context, url, object : ExtractionListener {
        override fun onProgress(progress: Int) {
          sendEvent("extractionProgress", mapOf("progress" to progress))
        }

        override fun onSuccess(product: ExtractedProduct) {
          val result = mapOf(
            "title" to product.title,
            "brand" to product.brand,
            "price" to product.price,
            "originalPrice" to product.originalPrice,
            "imageUrl" to product.imageUrl,
            "imageUrls" to product.imageUrls
          )
          promise.resolve(result)
        }

        override fun onError(error: ExtractionError) {
          promise.reject("EXTRACTION_ERROR", error.message ?: "Unknown extraction error", error)
        }
      })
    }

    AsyncFunction("shareImageWithText") { imagePath: String, message: String, dialogTitle: String, promise: Promise ->
      val activity = appContext.currentActivity ?: throw Exception("Activity is null")
      try {
        val cleanPath = if (imagePath.startsWith("file://")) imagePath.substring(7) else imagePath
        val file = java.io.File(cleanPath)

        if (!file.exists() || !file.isFile || !file.canRead()) {
          promise.reject("SHARE_ERROR", "Image file does not exist or is not readable: $cleanPath", null)
          return@AsyncFunction
        }

        val authority = "${activity.packageName}.FileSystemFileProvider"
        val contentUri: android.net.Uri = androidx.core.content.FileProvider.getUriForFile(activity, authority, file)

        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
          type = "image/*"
          putExtra(android.content.Intent.EXTRA_STREAM, contentUri)
          putExtra(android.content.Intent.EXTRA_TEXT, message)
          addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        val chooser = android.content.Intent.createChooser(intent, dialogTitle).apply {
          addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        activity.startActivity(chooser)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("SHARE_ERROR", e.message ?: "Failed to share image via FileProvider", e)
      }
    }
  }
}
