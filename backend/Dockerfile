FROM node:20-bullseye

ENV PORT=8080 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# OS deps for Python, Nginx, Supervisor
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip nginx supervisor && \
    rm -rf /var/lib/apt/lists/*

# ---------------- Backend (FastAPI) ----------------
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip3 install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/app /app/backend/app
ENV PYTHONPATH=/app/backend
RUN mkdir -p /app/uploads

# ---------------- Frontend (Next.js) ----------------
WORKDIR /app/backend/frontend
COPY backend/frontend/package*.json ./
COPY backend/frontend/jsconfig.json ./
COPY backend/frontend/tsconfig.json ./
# Ensure devDependencies are installed for build (tailwind/postcss)
ENV NODE_ENV=development
RUN npm install --no-audit --no-fund
COPY backend/frontend/ .
# Allow build-time API base URL if needed
ARG NEXT_PUBLIC_API_BASE_URL=""
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# Build must run with production NODE_ENV to avoid dev runtime in server bundle
ENV NODE_ENV=production
RUN npm run build

# ---------------- Nginx + Supervisor ----------------
WORKDIR /app
COPY backend/nginx.conf /etc/nginx/nginx.conf
COPY backend/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 8080

CMD ["/usr/bin/supervisord","-c","/etc/supervisor/conf.d/supervisord.conf"]
