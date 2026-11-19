"""Regression checks for the dashboard's local and deployment modes."""
import ipaddress
import os
import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

import codex_reply
import drive_storage
import main

AUTH = ("dashboard-test", "test-only")
EXAMPLE = "내일 아침 일정은 산책이고 점심에 친구랑 밥 약속이 있어."


class DashboardTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        db = Path(directory) / "agent_server.db"
        self.enterContext(patch.object(main, "DB", db))
        self.enterContext(patch.object(main, "PROVIDERS", []))
        self.enterContext(patch.object(main, "ALLOWED", (ipaddress.ip_network("127.0.0.0/8"),)))
        self.enterContext(patch.dict(os.environ, {
            "ADMIN_USER": AUTH[0],
            "ADMIN_PASS": AUTH[1],
            "TASK_STORAGE": "sqlite",
            "CODEX_CLI_FALLBACK": "0",
            "KAKAO_REST_API_KEY": "",
            "KAKAO_CLIENT_SECRET": "",
            "KAKAO_REDIRECT_URI": "",
            "SESSION_SECRET": "",
            "KAKAO_LEGACY_OWNER_ID": "",
        }))

    def test_local_login_and_schedule_extraction(self):
        with TestClient(main.app, client=("127.0.0.1", 10001)) as client:
            self.assertEqual(client.get("/").status_code, 401)
            self.assertEqual(client.get("/api/tasks", auth=(AUTH[0], "wrong")).status_code, 401)
            self.assertEqual(client.get("/", auth=AUTH).status_code, 200)
            result = client.post("/api/chat", auth=AUTH, json={"message": EXAMPLE})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(
                [(task["time"], task["category"]) for task in result.json()["tasks"]],
                [("아침", "건강"), ("점심", "약속")],
            )
            worry = client.post("/api/chat", auth=AUTH, json={"message": "할 일이 너무 많아 막막해"})
            self.assertEqual(worry.json()["tasks"], [])
            rows = client.get("/api/tasks", auth=AUTH).json()["tasks"]
            self.assertEqual(len(rows), 2)
            path = f"/api/tasks/{rows[0]['id']}"
            self.assertEqual(client.patch(path, auth=AUTH, json={"done": True}).json(), {"done": True})
            self.assertEqual(client.delete(path, auth=AUTH).status_code, 204)
        with TestClient(main.app, client=("192.0.2.1", 10001)) as client:
            self.assertEqual(client.get("/", auth=AUTH, headers={"X-Forwarded-For": "127.0.0.1"}).status_code, 403)

    def test_kakao_login_and_account_isolation(self):
        from urllib.parse import parse_qs, urlsplit
        import kakao_login

        base = "https://dashboard.example"
        settings = {
            "KAKAO_REST_API_KEY": "test-client",
            "KAKAO_CLIENT_SECRET": "test-secret",
            "KAKAO_REDIRECT_URI": base + "/auth/kakao/callback",
            "SESSION_SECRET": "test-secret-only-" * 3,
        }
        with patch.dict(os.environ, settings), patch.object(kakao_login, "exchange", side_effect=[101, 202]):
            with TestClient(main.app, base_url=base, client=("127.0.0.1", 10001)) as client:
                self.assertEqual(client.get("/", follow_redirects=False).headers["location"], "/login")
                self.assertEqual(client.get("/api/tasks", auth=AUTH).status_code, 401)
                self.assertIn("카카오로 로그인", client.get("/login").text)

                def sign_in(expected_code):
                    start = client.get("/auth/kakao", follow_redirects=False)
                    location = urlsplit(start.headers["location"])
                    self.assertEqual(location.hostname, "kauth.kakao.com")
                    state = parse_qs(location.query)["state"][0]
                    response = client.get("/auth/kakao/callback", params={"state": state, "code": expected_code},
                                          follow_redirects=False)
                    self.assertEqual(response.headers["location"], "/")
                    self.assertIn("HttpOnly", response.headers["set-cookie"])
                    self.assertIn("Secure", response.headers["set-cookie"])

                bad = client.get("/auth/kakao/callback", params={"state": "bad", "code": "untrusted"},
                                 follow_redirects=False)
                self.assertNotEqual(bad.headers.get("location"), "/")
                sign_in("first")
                origin = {"Origin": base}
                self.assertEqual(client.post("/api/chat", json={"message": EXAMPLE}).status_code, 403)
                self.assertEqual(client.post("/api/chat", headers=origin, json={"message": EXAMPLE}).status_code, 200)
                rows = client.get("/api/tasks").json()["tasks"]
                self.assertEqual(len(rows), 2)
                first = rows[0]["id"]
                self.assertNotIn("owner", rows[0])
                self.assertEqual(client.post("/auth/logout", headers=origin, follow_redirects=False).status_code, 303)
                self.assertEqual(client.get("/api/tasks").status_code, 401)
                sign_in("second")
                self.assertEqual(client.get("/api/tasks").json()["tasks"], [])
                self.assertEqual(client.patch(f"/api/tasks/{first}", headers=origin, json={"done": True}).status_code, 404)
                self.assertEqual(client.delete(f"/api/tasks/{first}", headers=origin).status_code, 404)

    def test_old_schema_migration_preserves_tasks(self):
        from contextlib import closing
        with closing(sqlite3.connect(main.DB)) as db, db:
            db.execute("""CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT,
                       title TEXT NOT NULL, day TEXT NOT NULL, time TEXT NOT NULL,
                       category TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)""")
            db.execute("INSERT INTO tasks (title, day, time, category, done) VALUES (?, ?, ?, ?, ?)",
                       ("기존 일정", main.today().isoformat(), "오전", "업무", 1))
            self.assertTrue(main.prepare_db(db, "kakao:app:101"))
            self.assertEqual(db.execute("SELECT title, done, owner FROM tasks").fetchall(),
                             [("기존 일정", 1, "kakao:app:101")])
        with closing(sqlite3.connect(main.DB)) as db, db:
            self.assertFalse(main.prepare_db(db, "kakao:app:202"))
            self.assertEqual(db.execute("SELECT owner FROM tasks").fetchone()[0], "kakao:app:101")

    def test_cli_response_and_failure_fallback(self):
        with patch.dict(os.environ, {"CODEX_CLI_FALLBACK": "1"}):
            with TestClient(main.app, client=("127.0.0.1", 10001)) as client:
                data = {"message": "어떤 AI인지 소개해 줘."}
                with patch.object(codex_reply, "reply", return_value='{"reply":"AI 비서입니다.","tasks":[]}') as cli:
                    result = client.post("/chat", auth=AUTH, json=data)
                    self.assertEqual(result.json()["engine"], "codex-cli")
                    self.assertIn(data["message"], cli.call_args.args[0])
                with patch.object(codex_reply, "reply", side_effect=codex_reply.CodexError):
                    result = client.post("/api/chat", auth=AUTH, json=data)
                    self.assertEqual(result.json()["engine"], "fallback")
                    self.assertEqual(result.json()["tasks"], [])

    def test_drive_write_failure_and_restart(self):
        from contextlib import closing
        with closing(sqlite3.connect(main.DB)) as db, db:
            db.execute(main.SCHEMA)
            db.execute("INSERT INTO tasks (title, day, time, category) VALUES (?, ?, ?, ?)",
                       ("이전 일정", main.today().isoformat(), "", "기타"))

        remote = None
        fail_write = False
        creates = 0

        def drive_api(request):
            nonlocal remote, creates
            if str(request.url) == drive_storage.TOKEN_URL:
                return httpx.Response(200, json={"access_token": "test", "expires_in": 3600})
            self.assertEqual(request.headers["Authorization"], "Bearer test")
            if request.url.path == "/drive/v3/files":
                self.assertEqual(request.url.params["spaces"], "appDataFolder")
                return httpx.Response(200, json={"files": [{"id": "test-db"}] if remote else []})
            if request.method == "POST":
                creates += 1
                self.assertIn(b'"parents": ["appDataFolder"]', request.content)
                position = request.content.index(b"SQLite format 3\x00")
                remote = request.content[position:].rsplit(b"\r\n--", 1)[0]
                return httpx.Response(200, json={"id": "test-db"})
            if request.method == "PATCH":
                if fail_write:
                    return httpx.Response(503)
                remote = request.content
                return httpx.Response(200, json={"id": "test-db"})
            self.assertEqual(request.url.params["alt"], "media")
            return httpx.Response(200, content=remote)

        real_client = httpx.Client
        with patch.dict(os.environ, {
            "TASK_STORAGE": "google-drive",
            "GOOGLE_DRIVE_CLIENT_ID": "test",
            "GOOGLE_DRIVE_CLIENT_SECRET": "test",
            "GOOGLE_DRIVE_REFRESH_TOKEN": "test",
        }), patch.object(drive_storage.httpx, "Client",
                         side_effect=lambda **_: real_client(transport=httpx.MockTransport(drive_api))):
            with TestClient(main.app, client=("127.0.0.1", 10001)) as client:
                rows = client.get("/api/tasks", auth=AUTH).json()["tasks"]
                self.assertEqual([task["title"] for task in rows], ["이전 일정"])
                saved = client.post("/api/chat", auth=AUTH, json={"message": EXAMPLE})
                self.assertEqual(saved.status_code, 200)
                fail_write = True
                self.assertEqual(client.delete("/api/tasks/1", auth=AUTH).status_code, 503)
            self.assertIsNone(main.DRIVE)
            with TestClient(main.app, client=("127.0.0.1", 10001)) as client:
                result = client.get("/api/tasks", auth=AUTH)
                self.assertEqual(result.status_code, 200)
                self.assertEqual([task["category"] for task in result.json()["tasks"]], ["기타", "건강", "약속"])
        self.assertEqual(creates, 1)


if __name__ == "__main__":
    unittest.main()
