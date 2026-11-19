"""Kakao OAuth and signed, time-limited local session cookies."""
import os
from dataclasses import dataclass
from urllib.parse import urlencode, urlsplit

import httpx
from itsdangerous import BadData, URLSafeTimedSerializer

CALLBACK = "/auth/kakao/callback"
SESSION_COOKIE = "__Host-dashboard_session"
STATE_COOKIE = "__Host-dashboard_state"
SESSION_SECONDS = 8 * 60 * 60
STATE_SECONDS = 10 * 60


@dataclass(frozen=True)
class Kakao:
    client_id: str
    client_secret: str
    redirect_uri: str
    origin: str
    signing_secret: str

    @classmethod
    def from_env(cls):
        key = os.getenv("KAKAO_REST_API_KEY", "").strip()
        secret = os.getenv("KAKAO_CLIENT_SECRET", "").strip()
        redirect = os.getenv("KAKAO_REDIRECT_URI", "").strip()
        signing = os.getenv("SESSION_SECRET", "").strip()
        if not any((key, secret, redirect, signing)):
            return None
        parsed = urlsplit(redirect)
        if (not key or len(signing) < 32 or parsed.scheme != "https" or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.path != CALLBACK or parsed.query or parsed.fragment):
            raise RuntimeError("카카오 REST API 키, HTTPS 콜백 주소, 32자 이상의 세션 비밀값이 필요합니다.")
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname.encode("idna").decode()
        port = f":{parsed.port}" if parsed.port not in (None, 443) else ""
        return cls(key, secret, redirect, f"https://{host}{port}", signing)

    def authorize(self, state):
        return "https://kauth.kakao.com/oauth/authorize?" + urlencode({
            "response_type": "code", "client_id": self.client_id,
            "redirect_uri": self.redirect_uri, "state": state,
        })

    def sign(self, value, purpose):
        return URLSafeTimedSerializer(self.signing_secret, salt=purpose).dumps(value)

    def verify(self, token, purpose, max_age):
        if not token:
            return None
        try:
            value = URLSafeTimedSerializer(self.signing_secret, salt=purpose).loads(token, max_age=max_age)
            return value if isinstance(value, str) else None
        except BadData:
            return None


def exchange(config, code):
    data = {
        "grant_type": "authorization_code", "client_id": config.client_id,
        "redirect_uri": config.redirect_uri, "code": code,
    }
    if config.client_secret:
        data["client_secret"] = config.client_secret
    with httpx.Client(timeout=8, trust_env=False) as client:
        token = client.post("https://kauth.kakao.com/oauth/token", data=data)
        token.raise_for_status()
        access = token.json()["access_token"]
        if not isinstance(access, str) or not access:
            raise ValueError("카카오 액세스 토큰 누락")
        account = client.get("https://kapi.kakao.com/v2/user/me",
                             headers={"Authorization": f"Bearer {access}"},
                             params={"property_keys": "[]"})
        account.raise_for_status()
        ident = account.json()["id"]
        if type(ident) is not int or ident <= 0:
            raise ValueError("카카오 사용자 ID 누락")
        return ident
