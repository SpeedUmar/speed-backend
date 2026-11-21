const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim().toLowerCase().replace(/^@/, '');
    if (!q) {
      return res.json({ users: [] });
    }

    const result = await pool.query(
      `SELECT id, username, display_name, bio, avatar_url, role, is_premium, is_online
       FROM users
       WHERE (username ILIKE $1 OR display_name ILIKE $1) AND id <> $2
       LIMIT 20`,
      [`%${q}%`, req.user.id]
    );

    res.json({ users: result.rows });
  } catch (err) {
    console.error('[USERS SEARCH]', err);
    res.status(500).json({ error: 'Ошибка поиска пользователей.' });
  }
});

router.patch('/me', authMiddleware, async (req, res) => {
  try {
    const { display_name, bio, avatar_url, privacy_last_seen } = req.body;
    const allowedPrivacy = ['everyone', 'contacts', 'nobody'];

    if (privacy_last_seen && !allowedPrivacy.includes(privacy_last_seen)) {
      return res.status(400).json({ error: 'Некорректное значение приватности.' });
    }

    const result = await pool.query(
      `UPDATE users
       SET display_name = COALESCE($1, display_name),
           bio = COALESCE($2, bio),
           avatar_url = COALESCE($3, avatar_url),
           privacy_last_seen = COALESCE($4, privacy_last_seen)
       WHERE id = $5
       RETURNING id, username, display_name, bio, avatar_url, role, is_premium, stars_balance, privacy_last_seen`,
      [display_name, bio, avatar_url, privacy_last_seen, req.user.id]
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[USERS UPDATE]', err);
    res.status(500).json({ error: 'Ошибка обновления профиля.' });
  }
});

router.post('/:targetId/block', authMiddleware, async (req, res) => {
  try {
    const { targetId } = req.params;
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Нельзя заблокировать самого себя.' });
    }

    await pool.query(
      `INSERT INTO blocked_users (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, targetId]
    );

    res.json({ ok: true, blocked: targetId });
  } catch (err) {
    console.error('[USERS BLOCK]', err);
    res.status(500).json({ error: 'Ошибка блокировки пользователя.' });
  }
});

module.exports = router;