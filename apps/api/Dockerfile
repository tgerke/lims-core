# Dev-grade image: runs from workspace source via tsx (matches the siblings'
# compose story). A production build would prune dev deps and pin digests.
FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @lims-core/api...
EXPOSE 3001
CMD ["pnpm", "--filter", "@lims-core/api", "start"]
