# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend .
RUN npm run build

# Run stage
FROM node:20-alpine
ENV NODE_ENV=production     PORT=8080
WORKDIR /app
COPY --from=builder /app .
EXPOSE 8080
CMD ["npm","start","--","-p","8080"]
