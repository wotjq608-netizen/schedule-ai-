$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment setup failed.' }
}
& $python -m pip install --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }

& $python -c "from dotenv import load_dotenv; import os, sys; load_dotenv('.env'); sys.exit(0 if os.getenv('KAKAO_REST_API_KEY') or (os.getenv('ADMIN_USER') and os.getenv('ADMIN_PASS')) else 1)"
if ($LASTEXITCODE -eq 1) {
    $env:ADMIN_USER = 'local'
    $env:ADMIN_PASS = [guid]::NewGuid().ToString('N')
    Write-Host "Local login: $($env:ADMIN_USER) / $($env:ADMIN_PASS)"
}
Write-Host 'Open http://127.0.0.1:8000/login'
& $python -m uvicorn main:app --host 127.0.0.1 --port 8000 --no-proxy-headers --no-access-log
