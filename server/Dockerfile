# Build from the repository root:  docker build -f server/Dockerfile -t code2video-server .
# The base image must match the pinned "playwright" version in server/package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

ENV NODE_ENV=production \
    JOBS_DIR=/tmp/jobs \
    PORT=8080

WORKDIR /app
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund

COPY shared ./shared
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src ./server/src

RUN mkdir -p /tmp/jobs && chown -R pwuser:pwuser /app /tmp/jobs
USER pwuser
WORKDIR /app/server
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "src/index.ts"]
