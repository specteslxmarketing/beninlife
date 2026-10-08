# BENINLIFE production image: Node 20 game server (Express + Socket.IO + SQLite) serving the built client.
# Multi-stage: build tools + dev dependencies stay in the build stage; the runtime image only has production deps.

# ---- build: compile better-sqlite3 (native), build the client (Vite) and the server (tsc), then drop dev deps ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm_config_fund=false npm_config_audit=false
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.* ./
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN npm run build && npm prune --omit=dev && npm cache clean --force

# ---- runtime ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/client/dist ./client/dist
RUN mkdir -p /data && chown node:node /data
USER node
# /data holds the SQLite DB + session secret. Mount a persistent disk here; without one (Render free) it resets on restart.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server/src/index.js"]
