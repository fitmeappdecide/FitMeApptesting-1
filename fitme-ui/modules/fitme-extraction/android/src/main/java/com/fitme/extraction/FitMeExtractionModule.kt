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
  }
}
