import os
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.update(
    ADMIN_USER="browser-test",
    ADMIN_PASS="browser-test-only",
    ALLOWED_CLIENT_NETWORKS="127.0.0.1/32",
    TASK_STORAGE="sqlite",
    CODEX_CLI_FALLBACK="0",
    KAKAO_REST_API_KEY="fake-kakao-project",
    KAKAO_CLIENT_SECRET="",
    KAKAO_REDIRECT_URI="https://127.0.0.1:8765/auth/kakao/callback",
    KAKAO_LEGACY_OWNER_ID="",
    SESSION_SECRET="browser-test-only-signing-secret-unused-in-production",
)

import main


def fake_exchange(config, code):
    if code != "test-authorization-code":
        raise ValueError("Unexpected test authorization code")
    return 12345


with TemporaryDirectory() as directory:
    root = Path(directory)
    cert, key = root / "cert.pem", root / "key.pem"
    (root / "openssl.cnf").write_text("[req]\ndistinguished_name = dn\n[dn]\nCN = localhost\n", encoding="ascii")
    result = subprocess.run(
        ["openssl", "req", "-config", "openssl.cnf", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
         "-subj", "/CN=localhost", "-keyout", key.name, "-out", cert.name],
        cwd=root, capture_output=True, text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr)
    main.DB = root / "dashboard.db"
    main.kakao_login.exchange = fake_exchange
    uvicorn.run(main.app, host="127.0.0.1", port=8765, ssl_certfile=str(cert),
                ssl_keyfile=str(key), access_log=False)
