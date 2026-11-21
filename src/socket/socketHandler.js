const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

const initSocket = (io) => {
  // Проверка токена при подключении клиента по WebSocket
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) {
      return next(new Error('Требуется токен авторизации'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error('Недействительный токен'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`[SOCKET] Подключился пользователь: ${userId}`);

    try {
      await pool.query('UPDATE users SET is_online = TRUE, last_seen = NOW() WHERE id = $1', [userId]);
      socket.broadcast.emit('user_status', { user_id: userId, is_online: true });

      // Автоматически добавляем пользователя в комнаты его чатов
      const chatsRes = await pool.query('SELECT chat_id FROM chat_members WHERE user_id = $1', [userId]);
      for (const row of chatsRes.rows) {
        socket.join(`chat_${row.chat_id}`);
      }
    } catch (err) {
      console.error('[SOCKET INIT]', err);
    }

    // Вход в конкретный чат
    socket.on('join_chat', (chatId) => {
      if (chatId) {
        socket.join(`chat_${chatId}`);
      }
    });

    // Выход из конкретного чата
    socket.on('leave_chat', (chatId) => {
      if (chatId) {
        socket.leave(`chat_${chatId}`);
      }
    });

    // Индикатор «печатает...»
    socket.on('typing', ({ chatId, isTyping }) => {
      if (!chatId) return;
      socket.to(`chat_${chatId}`).emit('user_typing', {
        chat_id: chatId,
        user_id: userId,
        is_typing: Boolean(isTyping),
      });
    });

    // Отключение пользователя
    socket.on('disconnect', async () => {
      console.log(`[SOCKET] Отключился пользователь: ${userId}`);
      try {
        await pool.query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = $1', [userId]);
        socket.broadcast.emit('user_status', {
          user_id: userId,
          is_online: false,
          last_seen: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[SOCKET DISCONNECT]', err);
      }
    });
  });
};

module.exports = initSocket;