# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
# When building with context=frontend/, package files are in the context root
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Run stage
FROM node:20-alpine
ENV NODE_ENV=production     PORT=8080
WORKDIR /app
COPY --from=builder /app .
EXPOSE 8080
CMD ["npm","start","--","-p","8080"]
