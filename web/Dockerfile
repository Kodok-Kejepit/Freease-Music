# Freease Web — satu container: server Node (API + proxy audio) + aplikasi web hasil build.

# ---------- 1. Build aplikasi web
FROM node:22-alpine AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- 2. Server
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080 CLIENT_DIR=/app/client/dist VOICE_DIR=/app/voice YTDLP_PATH=yt-dlp
# yt-dlp (pengambil audio YouTube yang paling rajin diperbarui) + plugin PO Token.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates tini \
  && pip3 install --no-cache-dir --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider \
  && apt-get purge -y python3-pip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client /client/dist /app/client/dist
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/voice /app/data && chown -R node:node /app
USER node
EXPOSE 8080
ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
