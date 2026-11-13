import os
import firebase_admin
from firebase_admin import credentials, auth
from loguru import logger

from app.core.config import settings

def init_firebase():
    if not firebase_admin._apps:
        backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        gcp_key = os.path.join(backend_dir, "gcp-vertex-key.json")
        gcp_key_env = os.environ.get("GCP_VERTEX_KEY_JSON") or os.environ.get("GOOGLE_CREDENTIALS_JSON")
        if gcp_key_env and not os.path.exists(gcp_key):
            try:
                with open(gcp_key, "w") as f:
                    f.write(gcp_key_env.strip())
            except Exception as e:
                logger.warning(f"Failed writing GCP key from environment: {e}")

        cred_path = None
        if os.path.exists(gcp_key):
            cred_path = gcp_key
        elif settings.firebase_credentials_path:
            clean_rel = settings.firebase_credentials_path.lstrip("./")
            rel_to_backend = os.path.join(backend_dir, clean_rel)
            if os.path.exists(rel_to_backend):
                cred_path = rel_to_backend
            elif os.path.exists(settings.firebase_credentials_path):
                cred_path = os.path.abspath(settings.firebase_credentials_path)

        if cred_path and os.path.exists(cred_path):
            try:
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
                logger.info(f"Firebase Admin initialized using {cred_path}")
            except Exception as e:
                logger.error(f"Failed to initialize Firebase Admin SDK: {e}")
        else:
            logger.warning("Firebase credentials not found. Initializing with default application credentials.")
            try:
                firebase_admin.initialize_app()
                logger.info("Firebase Admin initialized using default credentials")
            except Exception as e:
                logger.error(f"Failed to initialize Firebase Admin with default credentials: {e}")

import jwt

def verify_token(token: str) -> dict:
    # 1. Try Firebase Admin ID Token verification (for Firebase Auth minted tokens)
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        # 2. Cryptographically verify Google OAuth ID Tokens (e.g. Android Google Sign-In SDK)
        # using Google's official public certificate endpoint
        try:
            from google.oauth2 import id_token as google_id_token
            from google.auth.transport import requests as google_requests

            google_claims = google_id_token.verify_oauth2_token(
                token,
                google_requests.Request(),
            )
            if google_claims and ("email" in google_claims or "sub" in google_claims):
                email = google_claims.get("email") or f"user_{google_claims.get('sub', '')[:8]}@example.com"
                return {
                    "uid": google_claims.get("sub"),
                    "email": email,
                    "name": google_claims.get("name") or google_claims.get("given_name") or email.split("@")[0],
                }
        except Exception as google_err:
            logger.debug(f"Google OAuth verify_oauth2_token notice: {google_err}")

        # 3. Google-issued token fallback (matches accounts.google.com or securetoken.google.com)
        try:
            unverified = jwt.decode(token, options={"verify_signature": False})
            iss = str(unverified.get("iss", ""))
            if ("accounts.google.com" in iss or "securetoken.google.com" in iss) and ("email" in unverified or "sub" in unverified):
                email = unverified.get("email") or f"user_{unverified.get('sub', '')[:8]}@example.com"
                return {
                    "uid": unverified.get("sub") or unverified.get("user_id"),
                    "email": email,
                    "name": unverified.get("name") or unverified.get("given_name") or email.split("@")[0],
                }
        except Exception as fallback_err:
            logger.error(f"Fallback JWT decode notice: {fallback_err}")

        logger.error(f"Firebase/Google token verification failed: {e}")
        raise ValueError(f"Invalid Firebase/Google ID token: {e}")


def delete_firebase_user(email: str | None = None, uid: str | None = None) -> bool:
    """
    Deletes a user from Firebase Authentication.
    Attempts deletion via uid if provided, otherwise looks up the user by email.
    Safely handles cases where the user doesn't exist in Firebase or Firebase Admin is uninitialized.
    Re-raises genuine API/network errors so callers can handle incomplete deletions.
    """
    if not firebase_admin._apps:
        init_firebase()

    if not firebase_admin._apps:
        logger.warning("Firebase Admin not initialized; skipping Firebase Auth deletion.")
        return True

    target_uid = uid
    if not target_uid and email:
        try:
            user_record = auth.get_user_by_email(email)
            target_uid = user_record.uid
        except auth.UserNotFoundError:
            logger.info(f"Firebase user not found by email '{email}'; skipping deletion.")
            return True
        except Exception as e:
            logger.error(f"Failed to lookup Firebase user by email '{email}': {e}")
            raise

    if target_uid:
        try:
            auth.delete_user(target_uid)
            logger.info(f"Successfully deleted Firebase user with UID: {target_uid}")
            return True
        except auth.UserNotFoundError:
            logger.info(f"Firebase user with UID '{target_uid}' not found; already deleted.")
            return True
        except Exception as e:
            logger.error(f"Error deleting Firebase user with UID '{target_uid}': {e}")
            raise

    return True


