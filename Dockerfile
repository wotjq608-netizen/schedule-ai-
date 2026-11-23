FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
ENV CREWAI_DISABLE_TELEMETRY=true OTEL_SDK_DISABLED=true XDG_DATA_HOME=/tmp/crewai
COPY daily_reports.py report_form.html reports.js main.py assistant_api.py assistant_widget.html assistant.js assistant.css workspace.css shop.html drive_storage.py codex_reply.py kakao_login.py google_login.py materials.py dashboard.html login.html admin.html architecture.html materials.html ./
ENV TASK_STORAGE=google-drive PORT=8080 PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
EXPOSE 8080
CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port \"$PORT\" --no-proxy-headers --no-access-log --workers 1"]
