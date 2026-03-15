FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package.json
COPY tsconfig.base.json tsconfig.base.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-schemas/package.json packages/shared-schemas/package.json
COPY packages/shared-utils/package.json packages/shared-utils/package.json

RUN npm install

COPY apps/server apps/server
COPY packages/shared-types packages/shared-types
COPY packages/shared-schemas packages/shared-schemas
COPY packages/shared-utils packages/shared-utils

WORKDIR /app/apps/server

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
