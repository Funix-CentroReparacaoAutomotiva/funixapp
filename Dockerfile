# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional CA mount for managed development environments; not stored in layers.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY shared ./shared
RUN npm run build
ARG APP_REVISION=development
RUN APP_REVISION="$APP_REVISION" node --input-type=module -e \
    'import {writeFileSync} from "node:fs"; const revision=process.env.APP_REVISION; if (!/^(development|[a-f0-9]{40})$/.test(revision)) process.exit(1); writeFileSync("dist/release.json", JSON.stringify({revision}));'

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY --chmod=0644 deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -Y off -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
# Avoid entrypoint scripts that try to modify the read-only filesystem.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]

FROM node:24.19.0-bookworm-slim AS api
ENV NODE_ENV=production FUNIX_API_HOST=0.0.0.0 FUNIX_API_PORT=8787
WORKDIR /app
# Node 24 runs the erasable TypeScript directly; no runtime npm dependencies.
COPY --chown=node:node package.json ./
COPY --chown=node:node server/*.ts ./server/
COPY --chown=node:node shared ./shared
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e 'fetch("http://127.0.0.1:8787/api/ready",{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", "--use-env-proxy", "server/index.ts"]
