# Dev-grade image: Vite dev server with /api proxied to the api service.
FROM node:22-slim
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @lims-core/web...
EXPOSE 5174
ENV LIMS_API_PROXY=http://api:3001
CMD ["pnpm", "--filter", "@lims-core/web", "dev", "--", "--host"]
