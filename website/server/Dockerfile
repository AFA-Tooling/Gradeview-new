FROM node:20-alpine3.17

WORKDIR /website
ENV PATH="./node_modules/.bin:$PATH"

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

WORKDIR /website/server
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

CMD ["npm", "start"]