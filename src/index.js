const config = require('./config');
const { openDb } = require('./db');
const { createServer } = require('./server');
const { createCourier } = require('./courier');
const { startWorker } = require('./worker');

const db = openDb();

createServer({ db, secret: config.webhookSecret }).listen(config.port, () => {
  console.log(`service on :${config.port}`);
});

startWorker(db, createCourier(config.courierUrl));
