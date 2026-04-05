FROM apify/actor-node-playwright-chrome:20

WORKDIR /home/myuser/app

COPY --chown=myuser:myuser packages/shared/package*.json ./packages/shared/
COPY --chown=myuser:myuser packages/shared/tsconfig.json ./packages/shared/
COPY --chown=myuser:myuser packages/shared/src ./packages/shared/src

COPY --chown=myuser:myuser packages/auto-price-tracker/package*.json ./packages/auto-price-tracker/
COPY --chown=myuser:myuser packages/auto-price-tracker/tsconfig.json ./packages/auto-price-tracker/
COPY --chown=myuser:myuser packages/auto-price-tracker/src ./packages/auto-price-tracker/src

RUN cd /home/myuser/app/packages/shared && npm install --include=dev --no-fund && npm run build
RUN cd /home/myuser/app/packages/auto-price-tracker && npm install --include=dev --no-fund && npm run build

WORKDIR /home/myuser/app/packages/auto-price-tracker

CMD ["npm", "start"]
