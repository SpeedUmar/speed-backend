const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, cm.member_role,
              (SELECT content FROM messages m WHERE m.chat_id = c.id AND m.is_deleted = FALSE ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages m WHERE m.chat_id = c.id AND m.is_deleted = FALSE ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE cm.user_id = $1
       ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC`,
      [req.user.id]
    );

    res.json({ chats: result.rows });
  } catch (err) {
    console.error('[CHATS LIST]', err);
    res.status(500).json({ error: 'Ошибка загрузки списка чатов.' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { type, title, description, member_ids = [], target_user_id } = req.body;
    if (!['private', 'group', 'channel'].includes(type)) {
      return res.status(400).json({ error: 'Тип чата должен быть: private, group или channel.' });
    }

    await client.query('BEGIN');

    if (type === 'private') {
      if (!target_user_id || target_user_id === req.user.id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Укажите собеседника для личного чата.' });
      }

      const existing = await client.query(
        `SELECT c.id FROM chats c
         JOIN chat_members m1 ON m1.chat_id = c.id AND m1.user_id = $1
         JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id = $2
         WHERE c.type = 'private' LIMIT 1`,
        [req.user.id, target_user_id]
      );

      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return res.json({ chat_id: existing.rows[0].id, existed: true });
      }
    }

    const chatRes = await client.query(
      `INSERT INTO chats (type, title, description, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [type, (title || '').trim(), (description || '').trim(), req.user.id]
    );
    const chat = chatRes.rows[0];

    await client.query(
      `INSERT INTO chat_members (chat_id, user_id, member_role)
       VALUES ($1, $2, 'owner')`,
      [chat.id, req.user.id]
    );

    const participants = new Set(type === 'private' ? [target_user_id] : member_ids);
    for (const uid of participants) {
      if (uid && uid !== req.user.id) {
        await client.query(
          `INSERT INTO chat_members (chat_id, user_id, member_role)
           VALUES ($1, $2, 'member')
           ON CONFLICT DO NOTHING`,
          [chat.id, uid]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ chat });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CHATS CREATE]', err);
    res.status(500).json({ error: 'Ошибка создания чата.' });
  } finally {
    client.release();
  }
});

router.get('/:chatId/messages', authMiddleware, async (req, res) => {
  try {
    const { chatId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);

    const memberCheck = await pool.query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Вы не являетесь участником этого чата.' });
    }

    const result = await pool.query(
      `SELECT m.*, u.username AS sender_username, u.display_name AS sender_name, u.avatar_url AS sender_avatar, u.role AS sender_role, u.is_premium AS sender_premium
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.chat_id = $1 AND m.is_deleted = FALSE
       ORDER BY m.created_at ASC
       LIMIT $2`,
      [chatId, limit]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error('[MESSAGES LIST]', err);
    res.status(500).json({ error: 'Ошибка загрузки сообщений.' });
  }
});

router.post('/:chatId/messages', authMiddleware, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content = '', type = 'text', media_url = '', media_meta = {}, reply_to_id = null, forwarded_from_id = null } = req.body;

    const chatRes = await pool.query(
      `SELECT c.type, cm.member_role
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       WHERE c.id = $1 AND cm.user_id = $2`,
      [chatId, req.user.id]
    );

    if (chatRes.rows.length === 0) {
      return res.status(403).json({ error: 'Нет доступа к чату.' });
    }

    const { type: chatType, member_role: memberRole } = chatRes.rows[0];
    if (chatType === 'channel' && !['owner', 'admin'].includes(memberRole) && req.user.role !== 'founder') {
      return res.status(403).json({ error: 'Публиковать в канале могут только администраторы.' });
    }

    if (!content.trim() && !media_url) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым.' });
    }

    const msgRes = await pool.query(
      `INSERT INTO messages (chat_id, sender_id, reply_to_id, forwarded_from_id, type, content, media_url, media_meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [chatId, req.user.id, reply_to_id, forwarded_from_id, type, content, media_url, media_meta]
    );

    const message = msgRes.rows[0];
    const io = req.app.get('io');
    if (io) {
      io.to(`chat_${chatId}`).emit('new_message', message);
    }

    res.status(201).json({ message });
  } catch (err) {
    console.error('[MESSAGE SEND]', err);
    res.status(500).json({ error: 'Ошибка отправки сообщения.' });
  }
});

router.patch('/messages/:messageId', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    const result = await pool.query(
      `UPDATE messages
       SET content = $1, is_edited = TRUE
       WHERE id = $2 AND sender_id = $3 AND is_deleted = FALSE
       RETURNING *`,
      [content, messageId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сообщение не найдено или нет прав на редактирование.' });
    }

    const updated = result.rows[0];
    const io = req.app.get('io');
    if (io) {
      io.to(`chat_${updated.chat_id}`).emit('message_edited', updated);
    }

    res.json({ message: updated });
  } catch (err) {
    console.error('[MESSAGE EDIT]', err);
    res.status(500).json({ error: 'Ошибка редактирования сообщения.' });
  }
});

router.delete('/messages/:messageId', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;

    const result = await pool.query(
      `UPDATE messages
       SET is_deleted = TRUE, content = ''
       WHERE id = $1 AND sender_id = $2
       RETURNING id, chat_id`,
      [messageId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Сообщение не найдено или нет прав на удаление.' });
    }

    const deleted = result.rows[0];
    const io = req.app.get('io');
    if (io) {
      io.to(`chat_${deleted.chat_id}`).emit('message_deleted', deleted);
    }

    res.json({ ok: true, id: deleted.id });
  } catch (err) {
    console.error('[MESSAGE DELETE]', err);
    res.status(500).json({ error: 'Ошибка удаления сообщения.' });
  }
});

module.exports = router;