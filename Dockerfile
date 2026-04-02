FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

ENV NODE_ENV=production
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD wget -qO- http://127.0.0.1:5000/health >/dev/null || exit 1

CMD ["node", "src/app.js"]
