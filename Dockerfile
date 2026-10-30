FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/Backend

COPY --chown=node:node Backend/package.json Backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node Backend/src ./src
COPY --chown=node:node Backend/migrations ./migrations
COPY --chown=node:node Backend/assets ./assets
# admin-browser.js resolves this sibling directory from Backend/src/routes.
COPY --chown=node:node Frontend/Admin/index.html Frontend/Admin/app.js Frontend/Admin/model.mjs Frontend/Admin/styles.css /app/Frontend/Admin/
COPY --chown=node:node Frontend/Admin/assets /app/Frontend/Admin/assets

USER node
CMD ["npm", "start"]
