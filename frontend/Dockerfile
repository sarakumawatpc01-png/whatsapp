FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci

ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_SUPERADMIN_SLUG
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL}
ENV VITE_SUPERADMIN_SLUG=${VITE_SUPERADMIN_SLUG}

COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist /app/dist
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4173/ >/dev/null || exit 1
CMD ["npx", "serve", "-s", "/app/dist", "-l", "4173"]
