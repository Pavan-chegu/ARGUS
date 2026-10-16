# ─── Stage 1: build frontend ──────────────────────────────────────────────
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ .
RUN npm run build

# ─── Stage 2: backend runtime (serves the API and the built UI) ───────────
FROM python:3.11-slim AS backend

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN adduser --disabled-password --gecos '' argus
USER argus

# Hosting platforms (Render, Railway, Fly) inject PORT; 8001 locally.
ENV PORT=8001 \
    LLM_CACHE_DIR=/tmp/llm_cache \
    PYTHONUNBUFFERED=1
EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health', timeout=4)"

# One worker: agents keep per-process singletons and the free tiers have ~512 MB.
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
