# Backend image — build context is the REPOSITORY ROOT.
#
# The backend is part of the pnpm workspace and imports `@osvald/shared`, so the
# build needs the root lockfile, the workspace definition and both packages:
#
#   docker build -f packages/backend/Dockerfile -t osvald-backend .
#
# docker-compose.yml reuses this single image for the `backend` service and the
# optional `worker` service (they differ only by the start command).
#
# TODO(prod): this image installs the workspace as-is, which is ideal for local
# development but fat for production. For a slim runtime, build here and copy
# only `packages/backend/dist`, `packages/shared/dist` and the pruned
# production `node_modules` (e.g. via `pnpm deploy --prod`) into a fresh stage.

FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install --global pnpm@12.5.1

WORKDIR /repo

# Manifests first so the dependency layer is cached independently of the source.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

# `@osvald/backend...` = the backend plus its workspace dependencies (shared).
RUN pnpm install --frozen-lockfile --filter "@osvald/backend..."

COPY packages/shared packages/shared
COPY packages/backend packages/backend

RUN pnpm --filter @osvald/shared build \
  && pnpm --filter @osvald/backend build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# The API is the default entry point; the worker service overrides `command`.
CMD ["node", "packages/backend/dist/index.js"]
