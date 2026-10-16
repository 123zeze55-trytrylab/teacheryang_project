FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/.data REQUIRE_ACCESS_CODE=1 COOKIE_SECURE=1
WORKDIR /app
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node teaching ./teaching
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
