# --- STAGE 1: Build ---
FROM node:20-slim AS builder
WORKDIR /app

# 1. Install build tools for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 2. Copy ONLY package.json (We will ignore the lockfile for the container build)
COPY package.json ./

# 3. THE FIX: Force install the exact Linux-GNU binary needed for CSS
# Then run a standard install to get everything else
RUN npm install lightningcss-linux-x64-gnu
RUN npm install

# 4. Now copy the rest of the source
COPY . .

# [Your ARGs for API Key/Environment Variables]
# Define the arguments
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_MASTER_HIVE_KEY

# Convert them to Environment Variables so Next.js can see them
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_MASTER_HIVE_KEY=$NEXT_PUBLIC_MASTER_HIVE_KEY

# 5. Disable Turbopack for Build (Optional but recommended if it keeps failing)
# Most production builds are more stable with the standard webpack-based build
ENV NEXT_PRIVATE_LOCAL_TURBOPACK=0

RUN npm run build

# --- STAGE 2: Runner ---
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]



