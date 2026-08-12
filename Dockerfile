FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
RUN npx prisma generate

COPY src ./src
RUN npx nest build


FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# argon2 ships a prebuilt binary but still needs libstdc++ at runtime.
RUN apk add --no-cache libstdc++ \
  && addgroup -S app && adduser -S app -G app

# --chown on each COPY: a later `chown -R` would rewrite every file and store a
# second full copy of the app as its own layer.
COPY --chown=app:app package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && chown -R app:app node_modules

COPY --from=build --chown=app:app /app/dist ./dist

USER app
EXPOSE 3000

# Migrations are applied by the `migrate` service, not here: shipping the
# Prisma CLI in the runtime image costs ~480MB for something that runs once.
CMD ["node", "dist/main"]
