const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

pool.on('connect', () => {
  console.log('[DB] Успешное подключение к базе данных PostgreSQL (speed_db)');
});

pool.on('error', (err) => {
  console.error('[DB] Критическая ошибка базы данных:', err);
});

module.exports = pool;