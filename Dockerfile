# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build the React frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* frontend/bun.lockb* ./
RUN npm install --legacy-peer-deps

COPY frontend/ ./

# Inline env vars for the Vite build — passed as build args
ARG VITE_API_TOKEN
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_WS_URL
ENV VITE_API_TOKEN=$VITE_API_TOKEN \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_WS_URL=$VITE_WS_URL

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Backend — Bun runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.2-alpine AS backend

WORKDIR /app

# Install backend dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Copy built frontend into backend so it can serve static assets
COPY --from=frontend-build /frontend/dist ./frontend/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["bun", "run", "src/server.ts"]
