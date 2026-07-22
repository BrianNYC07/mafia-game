# Web image: build the React app, then serve it with nginx. nginx also does the
# room-hash routing to the backends and (in prod) TLS termination. The nginx
# *config* is mounted at runtime (see docker-compose.yml) so the same image
# serves both the HTTP bring-up and the TLS deploy without a rebuild.

# --- build the React frontend (same-origin: talks to /socket.io/ via nginx) ---
FROM node:20-alpine AS build
WORKDIR /front
ENV CI=false
# "/" => connect to the same origin nginx serves this build from.
ARG REACT_APP_SERVER_URL=/
ENV REACT_APP_SERVER_URL=$REACT_APP_SERVER_URL
COPY app/front/package.json app/front/package-lock.json* ./
RUN npm ci || npm install
COPY app/front/ ./
RUN npm run build

# --- static file server ---
FROM nginx:1.27-alpine
# Webroot for the Let's Encrypt HTTP-01 challenge (see deploy/DEPLOY.md).
RUN mkdir -p /var/www/certbot
COPY --from=build /front/build /usr/share/nginx/html
