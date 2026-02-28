# ---- Backend Dockerfile ----
FROM node:22-alpine

# Add build tools for native dependencies (pdf-parse, cheerio, etc.)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install dependencies (npm install is more forgiving than npm ci)
RUN npm install --omit=dev

# Copy application code
COPY server.js ./
COPY services/ ./services/

# Create uploads directory for multer
RUN mkdir -p uploads

EXPOSE 6001

CMD ["node", "server.js"]
