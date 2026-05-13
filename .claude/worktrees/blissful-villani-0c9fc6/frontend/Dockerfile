# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend .
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_STUDIO_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_STUDIO_URL=$NEXT_PUBLIC_STUDIO_URL
RUN npm run build

# Run stage
FROM node:20-alpine
ENV NODE_ENV=production     PORT=8080
WORKDIR /app
COPY --from=builder /app .
EXPOSE 8080
CMD ["npm","start","--","-p","8080"]
