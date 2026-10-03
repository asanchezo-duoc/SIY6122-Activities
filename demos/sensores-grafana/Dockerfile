FROM node:24-alpine

WORKDIR /app

# Instalar dependencias primero para aprovechar la caché de capas
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# No correr como root
USER node

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
