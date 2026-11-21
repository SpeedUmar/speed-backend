const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { Server } = require('socket.io');
require('dotenv').config();

const pool = require('./конфигурация/db');
const initSocket = require('./розетка/socketHandler');

// const authRoutes = require('./маршруты/auth.routes');
const usersRoutes = require('./маршруты/users.routes');
const chatsRoutes = require('./маршруты/chats.routes');
const mediaRoutes = require('./маршруты/media.routes');
const starsRoutes = require('./маршруты/stars.routes');
const premiumRoutes = require('./маршруты/premium.routes');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  },
});

app.set('io', io);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Раздача загруженных медиафайлов
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Проверка работы сервера
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', messenger: 'SPEED', db: 'connected' });
  } catch (err) {
    console.error('[HEALTHCHECK]', err);
    res.status(500).json({ status: 'error', error: 'Нет подключения к базе данных' });
  }
});

// Подключение маршрутов API
// app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/stars', starsRoutes);
app.use('/api/premium', premiumRoutes);

// Запуск WebSocket-обработчика
initSocket(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`[SPEED SERVER] Запущен на порту ${PORT}`);
});
