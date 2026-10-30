# syntax=docker/dockerfile:1
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache wget
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 4000
# The API container migrates (and optionally seeds) then serves. The worker service overrides CMD.
CMD ["./docker-entrypoint.sh"]
