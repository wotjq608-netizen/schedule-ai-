import json
import logging
import os
import subprocess
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory, TemporaryFile
from threading import BoundedSemaphore

ROOT = Path(__file__).resolve().parent
VENDOR_ROOT = Path("/usr/local/lib/codex-cli/x86_64-unknown-linux-musl")
SHARED_AUTH = Path("/etc/codex-shared/auth.json")
PRIVATE = ROOT / ".chatbot-private"
CLI_LOCK = BoundedSemaphore(1)
logger = logging.getLogger("uvicorn.error")


class CodexError(Exception):
    pass


class CodexBusy(CodexError):
    pass


def vendor_binary():
    for name in ("bin/codex", "codex/codex"):
        candidate = (VENDOR_ROOT / name).resolve()
        if candidate.is_relative_to(VENDOR_ROOT) and candidate.is_file() and os.access(candidate, os.X_OK):
            with candidate.open("rb") as binary:
                if binary.read(4) == b"\x7fELF":
                    return candidate
    raise CodexError("안전한 Codex 실행 파일을 찾을 수 없습니다.")


def sync_auth(home):
    data = json.loads(SHARED_AUTH.read_text(encoding="utf-8"))
    tokens = data.get("tokens")
    if not isinstance(tokens, dict) or not tokens.get("access_token"):
        raise CodexError("Codex 인증을 사용할 수 없습니다.")
    # The CLI's stored-auth schema requires this field. Never copy the real token.
    tokens["refresh_token"] = "disabled"
    temp = None
    try:
        with NamedTemporaryFile(mode="w", dir=home, encoding="utf-8", delete=False) as handle:
            temp = Path(handle.name)
            os.fchmod(handle.fileno(), 0o600)
            json.dump(data, handle)
        os.replace(temp, home / "auth.json")
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def reply(prompt):
    if not CLI_LOCK.acquire(blocking=False):
        raise CodexBusy("Codex CLI가 다른 요청을 처리 중입니다.")
    try:
        binary = vendor_binary()
        PRIVATE.mkdir(mode=0o700, exist_ok=True)
        home = PRIVATE / "codex-home"
        home.mkdir(mode=0o700, exist_ok=True)
        for path in (PRIVATE, home):
            if path.is_symlink() or path.stat().st_uid != os.getuid():
                raise CodexError("Codex 전용 경로의 소유권을 확인할 수 없습니다.")
            path.chmod(0o700)
        sync_auth(home)
        env = {key: os.environ[key] for key in ("HOME", "LANG", "LC_ALL", "SSL_CERT_FILE") if key in os.environ}
        env.update(CODEX_HOME=str(home), PATH=os.defpath, NO_COLOR="1")
        with TemporaryDirectory(prefix="run-", dir=PRIVATE) as workspace, TemporaryFile() as diagnostics:
            output = Path(workspace) / "reply.json"
            completed = subprocess.run(
                [str(binary), "--ask-for-approval", "never", "exec",
                 "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
                 "--ephemeral", "--sandbox", "read-only", "--cd", workspace,
                 "--disable", "shell_tool", "--disable", "unified_exec",
                 "--disable", "hooks", "--disable", "plugins",
                 "--color", "never", "-o", str(output), "-"],
                input=prompt, encoding="utf-8", cwd=workspace, env=env,
                stdout=subprocess.DEVNULL, stderr=diagnostics, timeout=75, check=False,
            )
            if completed.returncode:
                diagnostics.seek(0)
                error = diagnostics.read(24_000).decode("utf-8", errors="replace").lower()
                reasons = (
                    ("인증 응답 거부", ("401", "unauthorized")),
                    ("인증 형식 또는 갱신", ("refresh token", "refresh_token", "authentication")),
                    ("사용 한도", ("429", "usage limit", "quota")),
                    ("실행 옵션", ("unexpected argument", "unknown feature", "invalid value")),
                    ("연결", ("connection", "dns", "stream disconnected", "timed out", "websocket")),
                )
                reason = next((label for label, patterns in reasons if any(p in error for p in patterns)), "기타")
                logger.warning("Codex CLI 종료 코드 %s (%s)", completed.returncode, reason)
                raise CodexError("Codex CLI가 응답하지 않았습니다.")
            with output.open("rb") as response:
                content = response.read(24_001)
            if not content or len(content) > 24_000:
                raise CodexError("Codex CLI 응답 크기가 제한을 벗어났습니다.")
            return content.decode("utf-8").strip()
    except subprocess.TimeoutExpired:
        raise CodexError("Codex CLI 응답 시간이 초과됐습니다.") from None
    except (OSError, ValueError, AttributeError):
        raise CodexError("Codex CLI 인증 또는 응답을 읽을 수 없습니다.") from None
    finally:
        CLI_LOCK.release()
