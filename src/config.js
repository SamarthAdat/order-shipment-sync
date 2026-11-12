const env = process.env;

module.exports = {
  webhookSecret: env.WEBHOOK_SECRET || 'dev-secret',
  port: Number(env.PORT || 3000),
  courierPort: Number(env.COURIER_PORT || 4000),
  courierUrl: env.COURIER_URL || 'http://localhost:4000',
  dbPath: env.DB_PATH || 'orders.db',
};
