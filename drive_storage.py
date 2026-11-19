"""Private Google Drive persistence for a single dashboard instance."""
import json
import os
import secrets
import time
from threading import Lock
from urllib.parse import quote

import httpx

API = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
TOKEN_URL = "https://oauth2.googleapis.com/token"
FILE_NAME = "personal-ai-dashboard.sqlite3"
MIME = "application/x-sqlite3"
MAX_SIZE = 5_000_000


class StorageError(Exception):
    """Drive did not confirm a usable database or a completed write."""


class DriveStorage:
    def __init__(self, client_id, client_secret, refresh_token):
        self.credentials = {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        self.lock = Lock()
        self.token = ""
        self.expires = 0
        self.file_id = None

    @classmethod
    def from_env(cls):
        values = [os.getenv("GOOGLE_DRIVE_" + key, "").strip()
                  for key in ("CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN")]
        if not all(values):
            raise RuntimeError("Google Drive OAuth 환경 변수 세 개를 모두 설정하세요.")
        return cls(*values)

    def request(self, method, url, **kwargs):
        try:
            with httpx.Client(timeout=10, trust_env=False) as client:
                if time.monotonic() >= self.expires:
                    response = client.post(TOKEN_URL, data=self.credentials)
                    response.raise_for_status()
                    token = response.json()
                    self.token = token["access_token"]
                    self.expires = time.monotonic() + max(0, int(token["expires_in"]) - 60)
                headers = {"Authorization": f"Bearer {self.token}", **kwargs.pop("headers", {})}
                response = client.request(method, url, headers=headers, **kwargs)
                if response.status_code == 401:
                    self.expires = 0
                response.raise_for_status()
                return response
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            raise StorageError("Google Drive 요청을 확인할 수 없습니다.") from None

    def find_file(self):
        ids = []
        page = None
        try:
            while True:
                params = {"spaces": "appDataFolder", "q": f"name = '{FILE_NAME}' and trashed = false",
                          "fields": "nextPageToken,incompleteSearch,files(id)"}
                if page:
                    params["pageToken"] = page
                result = self.request("GET", API, params=params).json()
                if result.get("incompleteSearch"):
                    raise StorageError("Drive 검색이 완료되지 않았습니다.")
                ids.extend(entry["id"] for entry in result["files"])
                if len(ids) > 1:
                    raise StorageError("같은 이름의 Drive DB가 여러 개 있습니다.")
                page = result.get("nextPageToken")
                if not page:
                    return ids[0] if ids else None
        except (ValueError, KeyError, TypeError, AttributeError):
            raise StorageError("Drive 파일 목록을 읽을 수 없습니다.") from None

    def open_or_create(self, seed):
        self.file_id = self.find_file()
        if self.file_id:
            return self.read()
        data = seed()
        self.check_data(data)
        boundary = secrets.token_hex(20)
        metadata = json.dumps({"name": FILE_NAME, "parents": ["appDataFolder"], "mimeType": MIME})
        body = (
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{metadata}\r\n--{boundary}\r\nContent-Type: {MIME}\r\n\r\n"
        ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
        try:
            response = self.request("POST", UPLOAD, params={"uploadType": "multipart", "fields": "id"},
                                    headers={"Content-Type": f"multipart/related; boundary={boundary}"}, content=body)
            self.file_id = response.json()["id"]
        except (KeyError, ValueError, TypeError):
            raise StorageError("Drive DB 생성 여부를 확인할 수 없습니다.") from None
        return self.read()

    @staticmethod
    def check_data(data):
        if len(data) > MAX_SIZE or not data.startswith(b"SQLite format 3\x00"):
            raise StorageError("Drive DB 형식 또는 크기를 확인하세요.")

    def read(self):
        data = self.request("GET", f"{API}/{quote(self.file_id, safe='')}", params={"alt": "media"}).content
        self.check_data(data)
        return data

    def write(self, data):
        self.check_data(data)
        self.request("PATCH", f"{UPLOAD}/{quote(self.file_id, safe='')}", params={"uploadType": "media"},
                     headers={"Content-Type": MIME}, content=data)
