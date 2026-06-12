# --- build stage: компилируем TypeScript в dist/ (нужны devDeps) ---
FROM node:22-alpine AS build
WORKDIR /app

# Сначала только манифесты — чтобы слой npm ci кэшировался, пока зависимости не менялись.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- runtime stage: только прод-зависимости + собранный код ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Бот работает по long-polling: входящий порт не нужен.
# Запускаемся под непривилегированным пользователем node (есть в образе).
USER node

CMD ["node", "dist/bot.js"]
