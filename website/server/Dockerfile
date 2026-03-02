FROM node:20-alpine3.17

WORKDIR /website
ENV PATH="./node_modules/.bin:$PATH"

COPY package*.json ./
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-factor 2 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set maxsockets 1 \
 && npm install --no-audit --no-fund

COPY . .
RUN npm run build

WORKDIR /website/server
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi

CMD ["npm", "start"]