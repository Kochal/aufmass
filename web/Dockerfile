# React + TypeScript PWA, Vite dev server (directive 10). Dev only: source is
# bind-mounted and node_modules lives in an anonymous volume (see
# docker-compose.yml). A production build is a separate concern (decide with 03).
FROM node:20-slim

WORKDIR /app

# Install deps first for caching. The compose mount keeps /app/node_modules out
# of the bind mount so the image's install survives.
COPY package.json ./
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
