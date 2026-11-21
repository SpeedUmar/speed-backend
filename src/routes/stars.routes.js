const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const isFounder = (user) => user && user.role === 'founder';

// Проверка баланса и истории операций со звёздами
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const txRes = await pool.query(
      `SELECT t.*,
              u_from.username AS from_username,
              u_to.username AS to_username
       FROM star_transactions t
       LEFT JOIN users u_from ON u_from.id = t.from_user_id
       LEFT JOIN users u_to ON u_to.id = t.to_user_id
       WHERE t.from_user_id = $1 OR t.to_user_id = $1
       ORDER BY t.created_at DESC
       LIMIT 30`,
      [req.user.id]
    );

    res.json({
      balance: isFounder(req.user) ? 'unlimited' : Number(req.user.stars_balance),
      unlimited: isFounder(req.user),
      transactions: txRes.rows,
    });
  } catch (err) {
    console.error('[STARS BALANCE]', err);
    res.status(500).json({ error: 'Ошибка получения баланса SPEED Stars.' });
  }
});

// Перевод звёзд или отправка подарка другому пользователю
router.post('/send', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { to_user_id, amount, kind = 'transfer', gift_title = '' } = req.body;
    const starsAmount = parseInt(amount, 10);

    if (!to_user_id || to_user_id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Укажите получателя звёзд.' });
    }

    if (!Number.isInteger(starsAmount) || starsAmount <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Количество звёзд должно быть больше нуля.' });
    }

    if (!['transfer', 'gift'].includes(kind)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Недопустимый тип операции.' });
    }

    await client.query('BEGIN');

    const senderRes = await client.query(
      'SELECT id, role, stars_balance FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    const sender = senderRes.rows[0];

    const receiverRes = await client.query(
      'SELECT id, username, stars_balance FROM users WHERE id = $1 FOR UPDATE',
      [to_user_id]
    );
    if (receiverRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Получатель не найден.' });
    }

    const founderUnlimited = sender.role === 'founder';

    if (!founderUnlimited) {
      if (Number(sender.stars_balance) < starsAmount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Недостаточно SPEED Stars на балансе.' });
      }
      await client.query(
        'UPDATE users SET stars_balance = stars_balance - $1 WHERE id = $2',
        [starsAmount, sender.id]
      );
    }

    const updatedReceiver = await client.query(
      'UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2 RETURNING stars_balance',
      [starsAmount, to_user_id]
    );

    const txRes = await client.query(
      `INSERT INTO star_transactions (from_user_id, to_user_id, amount, kind, gift_title)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sender.id, to_user_id, starsAmount, kind, gift_title || null]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      transaction: txRes.rows[0],
      sender_balance: founderUnlimited ? 'unlimited' : Number(sender.stars_balance) - starsAmount,
      receiver_balance: Number(updatedReceiver.rows[0].stars_balance),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[STARS SEND]', err);
    res.status(500).json({ error: 'Ошибка отправки SPEED Stars.' });
  } finally {
    client.release();
  }
});

module.exports = router;