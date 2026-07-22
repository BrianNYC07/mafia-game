# Backend image: one authoritative Node instance. Compose runs two of these
# (back1/back2) behind nginx room-hash routing, both pointed at Redis so the
# Socket.IO adapter + room-ownership registry are active (multi-instance mode).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install against the lockfile first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

EXPOSE 3001
CMD ["node", "index.js"]
