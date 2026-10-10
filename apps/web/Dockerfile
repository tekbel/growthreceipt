# Built from the repo root so npm workspaces and the root lockfile resolve.
FROM node:24-slim AS build
WORKDIR /repo

# Public values are baked into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_GOOGLE_AUTH=false
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci

COPY apps/web apps/web
COPY packages packages
RUN npm run build:web

FROM node:24-slim
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo ./
CMD ["sh", "-c", "npm --workspace apps/web run start -- -H 0.0.0.0 -p ${PORT:-3000}"]
