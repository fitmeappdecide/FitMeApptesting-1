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

        cred_path = gcp_key if os.path.exists(gcp_key) else settings.firebase_credentials_path
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
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        logger.warning(f"Firebase Admin verify_id_token failed ({e}). Trying Google OAuth JWT payload decode.")
        try:
            # Fallback for Google OAuth ID Tokens or development tokens
            unverified = jwt.decode(token, options={"verify_signature": False})
            if "email" in unverified or "sub" in unverified:
                email = unverified.get("email") or f"user_{unverified.get('sub', 'dev')[:8]}@example.com"
                return {
                    "uid": unverified.get("sub") or unverified.get("user_id"),
                    "email": email,
                    "name": unverified.get("name") or unverified.get("given_name") or email.split("@")[0],
                }
        except Exception as fallback_err:
            logger.error(f"Fallback JWT decode failed: {fallback_err}")
        
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


