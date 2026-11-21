const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Доступ запрещён. Требуется авторизация.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userRes = await pool.query(
      'SELECT id, username, display_name, role, is_premium, premium_until, stars_balance FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Пользователь не найден.' });
    }

    req.user = userRes.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Недействительный или устаревший токен.' });
  }
};

module.exports = authMiddleware;