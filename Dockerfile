# syntax=docker/dockerfile:1
# (директива выше включает cache-mount; нужен BuildKit — в Docker 23+ он по умолчанию)

# --- build stage: компилируем TypeScript в dist/ (нужны devDeps) ---
FROM node:22-alpine AS build
WORKDIR /app

# Сначала только манифесты — чтобы слой npm ci кэшировался, пока зависимости не менялись.
COPY package.json package-lock.json ./
# Кэш скачанных пакетов переживает пересборки даже при смене lockfile.
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Выкидываем devDeps из node_modules — заберём готовый прод-набор в runtime без
# повторной установки (раньше тут был второй npm ci).
RUN npm prune --omit=dev

# --- runtime stage: только прод-зависимости + собранный код ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Бот работает по long-polling: входящий порт не нужен.
# Запускаемся под непривилегированным пользователем node (есть в образе).
USER node

# Healthcheck по heartbeat-файлу: бот обновляет его, пока опрашивает Telegram.
# Свежий файл (< 60 с) = healthy. HEARTBEAT_FILE должен совпадать с тем, что в config.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const f=process.env.HEARTBEAT_FILE||'/tmp/heartbeat';const{statSync}=require('node:fs');process.exit(Date.now()-statSync(f).mtimeMs<60000?0:1)"

CMD ["node", "dist/bot.js"]
