#############################################
# 0. Base (shared OS deps)
#############################################
FROM node:20-slim AS base
WORKDIR /app

# OS deps required for Prisma (OpenSSL 3, libc6, CA certs)
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl libc6 ca-certificates \
  && rm -rf /var/lib/apt/lists/*


#############################################
# 1. Dependencies
#############################################
FROM base AS deps

# Copy manifests together
COPY package.json package-lock.json* ./

# Prefer npm ci when lockfile exists
RUN npm install --include=dev


#############################################
# 2. Build
#############################################
FROM base AS build

# Copy deps + source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env (required for NEXT_PUBLIC_* variables)
ARG NEXT_PUBLIC_CONVEX_URL
ENV NEXT_PUBLIC_CONVEX_URL=${NEXT_PUBLIC_CONVEX_URL}

# Build Next.js
RUN npm run build


#############################################
# 3. Runner (Production)
#############################################
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy runtime artifacts (kept together)
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts

EXPOSE 8080
CMD ["node", "scripts/start-with-vault.mjs"]
