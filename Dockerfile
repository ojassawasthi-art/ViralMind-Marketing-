FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY registry/capabilities.json ./registry/capabilities.json
ENV NODE_ENV=production HOST=0.0.0.0
USER node
EXPOSE 3000
CMD ["node", "src/main.ts"]
