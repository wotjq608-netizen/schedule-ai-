"""Google OpenID Connect with server-side code exchange and nonce verification."""
import base64
import hashlib
import os
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode, urlsplit

import httpx
from google.auth import exceptions
from google.auth.transport import requests
from google.oauth2 import id_token

CALLBACK = "/auth/google/callback"
STATE_COOKIE = "__Host-dashboard_google_state"


@dataclass(frozen=True)
class Google:
    client_id: str
    client_secret: str
    redirect_uri: str
    origin: str

    @classmethod
    def from_env(cls):
        client_id = os.getenv("GOOGLE_LOGIN_CLIENT_ID", "").strip()
        secret = os.getenv("GOOGLE_LOGIN_CLIENT_SECRET", "").strip()
        uri = os.getenv("GOOGLE_LOGIN_REDIRECT_URI", "").strip()
        if not uri and os.getenv("RENDER_EXTERNAL_URL"):
            uri = os.environ["RENDER_EXTERNAL_URL"].rstrip("/") + CALLBACK
        try:
            parsed = urlsplit(uri)
            if (not client_id or not secret or parsed.scheme != "https" or not parsed.hostname
                    or parsed.username or parsed.password or parsed.path != CALLBACK or parsed.query or parsed.fragment):
                return None
            return cls(client_id, secret, uri, f"https://{parsed.netloc}")
        except ValueError:
            return None

    def authorize(self, state, nonce, verifier):
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
            "response_type": "code", "scope": "openid", "client_id": self.client_id,
            "redirect_uri": self.redirect_uri, "state": state, "nonce": nonce,
            "code_challenge": challenge, "code_challenge_method": "S256",
        })


def exchange(config, code, nonce, verifier):
    with httpx.Client(timeout=8, trust_env=False) as client:
        response = client.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": config.client_id, "client_secret": config.client_secret,
            "grant_type": "authorization_code", "redirect_uri": config.redirect_uri,
            "code_verifier": verifier,
        })
        response.raise_for_status()
    try:
        transport = requests.Request()
        claims = id_token.verify_oauth2_token(
            response.json()["id_token"], lambda *args, **kw: transport(*args, **{**kw, "timeout": 8}),
            config.client_id)
    except exceptions.GoogleAuthError as exc:
        raise ValueError("Google ID token rejected") from exc
    actual_nonce, subject = claims.get("nonce"), claims.get("sub")
    if (not isinstance(actual_nonce, str) or not secrets.compare_digest(actual_nonce.encode(), nonce.encode())
            or not isinstance(subject, str) or not 0 < len(subject) <= 255):
        raise ValueError("Google identity validation failed")
    return subject
