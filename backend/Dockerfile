# ---- Backend Dockerfile ----
FROM node:22-alpine

# Add build tools for native dependencies (pdf-parse, cheerio, etc.)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install the exact production dependency tree from the lockfile
RUN npm ci --omit=dev

# Copy application code
COPY server.js ./
COPY services/ ./services/

# Create uploads directory for multer
RUN mkdir -p uploads

EXPOSE 6001

CMD ["node", "server.js"]
