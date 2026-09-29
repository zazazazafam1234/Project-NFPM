# Build from the repository root so the shared tools package can be copied:
#   docker build -f pin-service/Dockerfile -t fastmovie-pin-service .
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

WORKDIR /app
COPY pin-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && python -m playwright install --with-deps chromium

COPY tools/netflix_login_checker ./tools/netflix_login_checker
COPY pin-service ./pin-service

ENV PIN_SERVICE_HOST=0.0.0.0 \
    PIN_SERVICE_PORT=5055 \
    PIN_SERVICE_PROFILES_DIR=/data/profiles
VOLUME ["/data/profiles"]
EXPOSE 5055
CMD ["python", "pin-service/run.py"]
