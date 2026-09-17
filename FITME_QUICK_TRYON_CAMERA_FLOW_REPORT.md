# FITME QUICK TRY-ON CAMERA FLOW REPORT

**Task**: Correct bottom navigation camera workflow to treat captured images as Outfit Reference Images for Quick Try-On, reusing the exact existing production Try-On pipeline without creating duplicate architecture or persisting camera captures as user model photos.

---

## 1. Root Cause Analysis of Previous Bug
Previously, tapping the bottom navigation camera button in `fitme-ui/app/(tabs)/_layout.tsx` opened the camera and automatically called `useSavedPhotosStore.getState().uploadPhoto(uri)`. This saved the captured outfit/reference image directly into the user's permanent model photo collection ("Your saved photos") with the display name "My Photo X", setting `localPhotoUri` and `savedPhotoId`. This incorrectly treated the outfit image as the user's personal model/body scan photo.

---

## 2. Files Inspected & Modified

### Modified Files (2 files only):
1. **`fitme-ui/app/(tabs)/_layout.tsx`**
   - **Change**: Updated `handleCameraPress()` so when a photo is captured (or selected via library fallback in simulator), it sets `useSession.getState().setProductImageUri(uri)` (storing it as the temporary outfit reference image) and navigates to `/upload-photo`.
   - **Data Isolation**: Removed calls to `useSavedPhotosStore.getState().uploadPhoto(uri)`, `setLocalPhotoUri`, and `setSavedPhotoId`.

2. **`fitme-ui/app/upload-photo.tsx`**
   - **Change**: Added an **Outfit to try** preview card at the top displaying `productImageUri` (the captured outfit reference image) with a "Change outfit" retake action.
   - **User Model Photo Section**: Preserved the "Choose your model photo" section below for selecting from "Your saved photos", taking a new user model photo (`Take photo`), or picking from `Gallery`.
   - **Continue Button**: On press, if `productImageUri` is set, calls the existing `productApi.uploadGarment(productImageUri)` to register the reference garment and obtain `productId`, then navigates to `/processing`.

---

## 3. State Separation Architecture

```
Bottom Navigation Camera
          ↓
  Image captured (uri)
          ↓
setProductImageUri(uri)  [useSession - Temporary Outfit Reference]
          ↓
Navigate to /upload-photo
          ↓
User selects Model Photo:
  selectSavedPhoto() / takePhoto() / pickFromGallery()
  → sets localPhotoUri & savedPhotoId  [useSession - User Model Photo]
          ↓
Continue Pressed:
  productApi.uploadGarment(productImageUri) → returns productId
          ↓
Existing /processing Screen
  → tryOnApi.start(scanId, productId, savedPhotoId)
          ↓
Existing Production VTON Engine (FASHN / Vertex AI)
          ↓
Existing Try-On Result Screen (/result)
```

### Confirmation of Data Separation
- **`productImageUri`**: Held temporarily in session memory as the Outfit Reference Image.
- **`savedPhotoId` / `localPhotoUri`**: Held as the User Model Photo.
- **`useSavedPhotosStore`**: **Never touched** by bottom camera captures.
- **"Your saved photos" strip**: Camera captures **never** appear under user saved photos.

---

## 4. Reuse of Existing Production Infrastructure
- **Try-On Pipeline**: 100% reused (`productApi.uploadGarment` → `productId` → `/processing` → `tryOnApi.start` → `tryOnApi.waitForResult`).
- **Backend Endpoints**: Unchanged (`POST /api/v1/product/upload-garment`, `POST /api/v1/tryon/start`).
- **Database Architecture**: Unchanged (Postgres `Garment` table for garments, `UserSavedPhoto` for user photos).
- **Storage Infrastructure**: Unchanged (Supabase `garments/` bucket for garment references, `scans/` bucket for user model photos).
- **VTON Engine / Provider**: Unchanged.

---

## 5. Tests Performed & Results

| Test # | Test Scenario | Result |
| :--- | :--- | :--- |
| **Test 1** | Bottom camera capture sets `productImageUri` without saving to `savedPhotosStore` | ✅ **PASS** |
| **Test 2** | Captured camera reference image is NOT present in "Your saved photos" | ✅ **PASS** |
| **Test 3** | Upload page displays `productImageUri` under "Outfit to try" | ✅ **PASS** |
| **Test 4** | User selects an existing saved model photo; `productImageUri` & `savedPhotoId` remain distinct | ✅ **PASS** |
| **Test 5** | Tapping Continue calls existing `productApi.uploadGarment()` and routes to `/processing` | ✅ **PASS** |
| **Test 6** | Retake outfit reference replaces only `productImageUri` without creating a user photo | ✅ **PASS** |
| **Test 7** | Upload screen "Take photo" creates and saves user model photo to `savedPhotosStore` | ✅ **PASS** |
| **Test 8** | Upload screen "Gallery" creates and saves user model photo | ✅ **PASS** |
| **Test 9** | Existing saved photos remain intact | ✅ **PASS** |
| **Test 10** | Try-On failure handling uses existing failure screen; outfit reference is not rendered as fake result | ✅ **PASS** |
| **Test 11** | Temporary outfit reference is not persisted in user photo collection on session exit | ✅ **PASS** |
| **Test 12** | TypeScript build check (`npx tsc --noEmit`) | ✅ **PASS** (0 errors) |

---

## 6. Git Status Output (`git status --short`)

```
 M fitme-ui/app/(tabs)/_layout.tsx
 M fitme-ui/app/upload-photo.tsx
```

*(Note: No commits, pushes, merges, or deployments were performed. Production infrastructure remained untouched.)*

---

## 7. Confirmation of Safety Constraints
- **No commit / push / merge / deploy**: Confirmed.
- **Production APK untouched**: Confirmed.
- **Supabase / Firebase / Railway configuration untouched**: Confirmed.
- **Home page Take Photo / Upload Media flow untouched**: Confirmed.
- **Frozen extraction engines untouched**: Confirmed.
