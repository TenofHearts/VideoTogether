FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-schemas/package.json packages/shared-schemas/package.json
COPY packages/shared-utils/package.json packages/shared-utils/package.json

RUN npm ci

COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/shared-types packages/shared-types
COPY packages/shared-schemas packages/shared-schemas
COPY packages/shared-utils packages/shared-utils

RUN npm run build --workspace @videoshare/web && npm run build --workspace @videoshare/server

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-schemas/package.json packages/shared-schemas/package.json
COPY packages/shared-utils/package.json packages/shared-utils/package.json

RUN npm ci --omit=dev --workspace @videoshare/server --include-workspace-root=false

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

WORKDIR /app/apps/server
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
