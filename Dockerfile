# Grue: interactive fiction server for LLM benchmarking.
# Build:  docker build -t grue .
# Run:    docker run -p 8081:8081 -e GRUE_API_KEYS=change-me -v grue-data:/data grue
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
# Fetch the catalog's downloadable games at build time (sha256-verified). Original games are in the repo.
RUN npm run setup

# Public by default inside a container: bind all interfaces. Set GRUE_API_KEYS, or Grue warns at startup
# that anyone can play and read results. The legacy text interface (TCP 8080) stays off while keys are set.
# No HTTP_PORT here: it would override the PORT that hosting platforms inject and health-check.
# Grue listens on $PORT when set, else 8081.
ENV HOST=0.0.0.0 \
    RESULTS_DIR=/data/results \
    REPLAYS_DIR=/data/replays
# Results and replays live under /data: mount a volume there (docker run -v, or a Railway/Render volume).
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
