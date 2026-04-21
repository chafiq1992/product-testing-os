############################
# (1) Build frontend stage #
############################
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
# Install deps and build the Next.js app
COPY frontend/package*.json ./
RUN npm ci --no-progress --silent
COPY frontend ./
# Generate production static build (Next.js 'output: "export"' writes to /frontend/out)
RUN npm run build

############################
# (2) Build backend stage  #
############################
FROM python:3.11-slim AS backend-build
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir --compile -r requirements.txt
# Copy backend source
COPY backend/app ./app

####################################
# (3) Final runtime image (Python) #
####################################
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    MALLOC_ARENA_MAX=2

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir --compile -r requirements.txt && \
    find /usr/local -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null; \
    find /usr/local -name '*.pyc' -delete 2>/dev/null; \
    true

# Copy backend code from build stage
COPY --from=backend-build /app/app ./app

# Copy backend static assets (page-builder-widget.js, etc.)
COPY backend/static ./backend_static

# Copy pre-built static frontend assets
COPY --from=frontend-build /frontend/out ./static

# Expose the Cloud Run port
EXPOSE 8080

# Start FastAPI with Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--timeout-keep-alive", "120"]
