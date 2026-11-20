FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py drive_storage.py codex_reply.py kakao_login.py dashboard.html login.html admin.html ./
ENV TASK_STORAGE=google-drive PORT=8080 PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
EXPOSE 8080
CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port \"$PORT\" --no-proxy-headers --no-access-log --workers 1"]
