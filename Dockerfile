FROM node:24.15.0-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM node:24.15.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HESTIA_MODE=demo HESTIA_ENV=dev HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
