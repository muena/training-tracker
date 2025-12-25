# Use official Node.js LTS image with build tools for better-sqlite3
FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy application files
COPY server.js ./
COPY database.js ./
COPY index.html ./
COPY app.js ./
COPY styles.css ./
COPY manifest.json ./

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8765

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8765
ENV AUTH_ENABLED=true
ENV AUTH_USERNAME=admin
ENV AUTH_PASSWORD=changeme
ENV DB_PATH=/app/data/training.db

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8765/', (r) => {process.exit(r.statusCode === 200 || r.statusCode === 401 ? 0 : 1)})"

# Start server
CMD ["node", "server.js"]
