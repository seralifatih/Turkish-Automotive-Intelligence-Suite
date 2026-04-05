FROM apify/actor-node-playwright-chrome:20

WORKDIR /home/myuser/app

COPY --chown=myuser:myuser packages/shared/package*.json ./packages/shared/
COPY --chown=myuser:myuser packages/shared/tsconfig.json ./packages/shared/
COPY --chown=myuser:myuser packages/shared/src ./packages/shared/src

COPY --chown=myuser:myuser packages/arabam-vehicle-scraper/package*.json ./packages/arabam-vehicle-scraper/
COPY --chown=myuser:myuser packages/arabam-vehicle-scraper/tsconfig.json ./packages/arabam-vehicle-scraper/
COPY --chown=myuser:myuser packages/arabam-vehicle-scraper/src ./packages/arabam-vehicle-scraper/src

RUN cd /home/myuser/app/packages/shared && npm install --include=dev --no-fund && npm run build
RUN cd /home/myuser/app/packages/arabam-vehicle-scraper && npm install --include=dev --no-fund && npm run build

WORKDIR /home/myuser/app/packages/arabam-vehicle-scraper

CMD ["npm", "start"]
