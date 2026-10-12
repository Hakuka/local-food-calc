FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
COPY dist ./dist
COPY server ./server
COPY lib/seed.json ./lib/seed.json
COPY package.json ./package.json
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
