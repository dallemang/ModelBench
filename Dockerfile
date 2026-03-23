# Stage 1: build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package.json ./
RUN npm install && npm install @rollup/rollup-linux-x64-musl
COPY index.html vite.config.js ./
COPY js/ ./js/
COPY main.js ./
COPY public/ ./public/
RUN npm run build

# Stage 2: Python runtime
FROM python:3.11-slim
WORKDIR /app

COPY python-backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY python-backend/ ./python-backend/
COPY --from=frontend-builder /app/dist ./dist

EXPOSE 8000
CMD ["python", "python-backend/server.py"]
