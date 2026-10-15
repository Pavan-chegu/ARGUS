# ─── Stage 1: build frontend ──────────────────────────────────────────────
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ .
RUN npm run build

# ─── Stage 2: backend runtime ─────────────────────────────────────────────
FROM python:3.11-slim AS backend

# System deps (needed by some falkordb / httpx transitive deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application source
COPY backend/ ./backend/

# Frontend static files served by FastAPI at /ui
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Non-root user for safety
RUN adduser --disabled-password --gecos '' argus
USER argus

EXPOSE 8001

# Uvicorn with production workers
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
