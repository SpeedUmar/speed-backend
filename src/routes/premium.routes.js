const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const PLANS = {
  1: { months: 1, stars_cost: 100, label: '1 месяц' },
  3: { months: 3, stars_cost: 270, label: '3 месяца' },
  12: { months: 12, stars_cost: 900, label: '12 месяцев' },
};

const PERKS = [
  'Значок SPEED Premium рядом с именем',
  'Увеличенный лимит размера файлов и больше закреплённых чатов',
  'Дополнительные темы оформления и расширенное описание профиля',
  'Приоритет в новых функциях и эксклюзивные реакции/подарки',
];

// Информация о подписке, тарифах и привилегиях
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const isFounder = req.user.role === 'founder';
    const active =
      isFounder ||
      Boolean(
        req.user.is_premium &&
          (!req.user.premium_until || new Date(req.user.premium_until) > new Date())
      );

    res.json({
      is_premium: active,
      is_founder: isFounder,
      premium_until: isFounder ? null : req.user.premium_until,
      plans: PLANS,
      perks: PERKS,
    });
  } catch (err) {
    console.error('[PREMIUM STATUS]', err);
    res.status(500).json({ error: 'Ошибка получения статуса SPEED Premium.' });
  }
});

// Активация или продление SPEED Premium за SPEED Stars
router.post('/subscribe', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const monthsKey = parseInt(req.body.months || '1', 10);
    const plan = PLANS[monthsKey];

    if (!plan) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Выберите тариф: 1, 3 или 12 месяцев.' });
    }

    await client.query('BEGIN');

    const userRes = await client.query(
      'SELECT id, role, is_premium, premium_until, stars_balance FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    const user = userRes.rows[0];
    const founderUnlimited = user.role === 'founder';

    if (!founderUnlimited) {
      if (Number(user.stars_balance) < plan.stars_cost) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Недостаточно SPEED Stars. Нужно ${plan.stars_cost}, на балансе ${user.stars_balance}.`,
        });
      }

      await client.query(
        'UPDATE users SET stars_balance = stars_balance - $1 WHERE id = $2',
        [plan.stars_cost, user.id]
      );
    }

    const now = new Date();
    const currentUntil =
      user.premium_until && new Date(user.premium_until) > now
        ? new Date(user.premium_until)
        : now;

    const nextUntil = new Date(currentUntil);
    nextUntil.setMonth(nextUntil.getMonth() + plan.months);

    const updatedRes = await client.query(
      `UPDATE users
       SET is_premium = TRUE, premium_until = $1
       WHERE id = $2
       RETURNING id, username, display_name, role, is_premium, premium_until, stars_balance`,
      [nextUntil.toISOString(), user.id]
    );

    await client.query(
      `INSERT INTO star_transactions (from_user_id, to_user_id, amount, kind, gift_title)
       VALUES ($1, NULL, $2, 'premium', $3)`,
      [user.id, plan.stars_cost, `SPEED Premium (${plan.label})`]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      user: updatedRes.rows[0],
      plan,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PREMIUM SUBSCRIBE]', err);
    res.status(500).json({ error: 'Ошибка оформления SPEED Premium.' });
  } finally {
    client.release();
  }
});

module.exports = router;