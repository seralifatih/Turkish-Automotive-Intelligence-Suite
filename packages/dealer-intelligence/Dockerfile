FROM apify/actor-node-playwright-chrome:20

WORKDIR /home/myuser/app

COPY --chown=myuser:myuser packages/shared/package*.json ./packages/shared/
COPY --chown=myuser:myuser packages/shared/tsconfig.json ./packages/shared/
COPY --chown=myuser:myuser packages/shared/src ./packages/shared/src

COPY --chown=myuser:myuser packages/dealer-intelligence/package*.json ./packages/dealer-intelligence/
COPY --chown=myuser:myuser packages/dealer-intelligence/tsconfig.json ./packages/dealer-intelligence/
COPY --chown=myuser:myuser packages/dealer-intelligence/src ./packages/dealer-intelligence/src

RUN cd /home/myuser/app/packages/shared && npm install --include=dev --no-fund && npm run build
RUN cd /home/myuser/app/packages/dealer-intelligence && npm install --include=dev --no-fund && npm run build

WORKDIR /home/myuser/app/packages/dealer-intelligence

CMD ["npm", "start"]
