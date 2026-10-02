# Build from the repository root so the shared tools package can be copied:
#   docker build -f pin-service/Dockerfile -t fastmovie-pin-service .
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

WORKDIR /app
COPY pin-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && python -m playwright install --with-deps chromium
# Virtual display: Chromium runs headed (PIN_SERVICE_HEADLESS=false), which Netflix flags less than headless.
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth && rm -rf /var/lib/apt/lists/*

COPY tools/netflix_login_checker ./tools/netflix_login_checker
COPY pin-service ./pin-service

ENV PIN_SERVICE_HOST=0.0.0.0 \
    PIN_SERVICE_PORT=5055 \
    PIN_SERVICE_PROFILES_DIR=/data/profiles \
    DISPLAY=:99 \
    PYTHONUNBUFFERED=1
VOLUME ["/data/profiles"]
EXPOSE 5055
# Xvfb in the background, the service in the foreground (xvfb-run can hang as PID 1).
CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & exec python -u pin-service/run.py"]
