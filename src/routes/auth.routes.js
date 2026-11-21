const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Временное хранилище одноразовых паролей (email -> { code, expiresAt })
const otpStore = new Map();

// Создаём колонку email в таблице users, если её ещё нет
async function ensureEmailColumn() {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE`);
  } catch (e) {
    console.error('[AUTH DB INIT]', e.message);
  }
}
ensureEmailColumn();

// Настройка почтового транспорта (Gmail SMTP)
function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

// 1. Запрос одноразового пароля на почту
router.post('/request-code', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Введите корректный адрес электронной почты.' });
    }

    const code = String(crypto.randomInt(100000, 999999));
    otpStore.set(email, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const transporter = getTransporter();
    if (transporter) {
      await transporter.sendMail({
        from: `"S⚡eed Messenger" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Код входа в S⚡eed: ${code}`,
        html: `
          <div style="font-family:sans-serif;background:#0b132b;color:#f8fafc;padding:28px;border-radius:14px;max-width:420px;margin:auto;">
            <h2 style="margin:0 0 12px;color:#38bdf8;">S⚡eed Messenger</h2>
            <p style="color:#cbd5e1;font-size:15px;">Ваш одноразовый пароль для входа в аккаунт:</p>
            <div style="font-size:32px;font-weight:800;letter-spacing:6px;background:#1e293b;color:#facc15;padding:14px;text-align:center;border-radius:10px;margin:18px 0;">
              ${code}
            </div>
            <p style="color:#94a3b8;font-size:12px;">Код действителен 10 минут. Никому не сообщайте его.</p>
          </div>
        `,
      });
      return res.json({ ok: true, sent: true, message: 'Одноразовый пароль отправлен на вашу почту!' });
    }

    console.log(`[S⚡eed OTP] Код для ${email}: ${code}`);
    return res.json({
      ok: true,
      sent: false,
      dev_code: code,
      message: 'SMTP не задан в Railway. Используйте резервный код.',
    });
  } catch (err) {
    console.error('[AUTH REQUEST CODE]', err);
    res.status(500).json({ error: 'Не удалось отправить письмо. Проверьте настройки почты.' });
  }
});

// 2. Проверка одноразового пароля и вход / авторегистрация
router.post('/verify-code', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const customName = (req.body.display_name || '').trim();

    if (!email || !code) {
      return res.status(400).json({ error: 'Укажите почту и одноразовый пароль.' });
    }

    const record = otpStore.get(email);
    if (!record || record.expiresAt < Date.now() || record.code !== code) {
      return res.status(400).json({ error: 'Неверный или истёкший одноразовый пароль.' });
    }

    otpStore.delete(email);
    await ensureEmailColumn();

    let userRes = await pool.query(
      'SELECT id, username, display_name, bio, avatar_url, role, is_premium, premium_until, stars_balance, email FROM users WHERE email = $1',
      [email]
    );

    let user = userRes.rows[0];

    if (!user) {
      const baseNick = email.split('@')[0].replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'speeduser';
      const uniqueUsername = `${baseNick}_${crypto.randomInt(100, 9999)}`;
      const displayName = customName || email.split('@')[0];

      const insertRes = await pool.query(
        `INSERT INTO users (username, display_name, email, password_hash, stars_balance)
         VALUES ($1, $2, $3, $4, 150)
         RETURNING id, username, display_name, bio, avatar_url, role, is_premium, premium_until, stars_balance, email`,
        [uniqueUsername, displayName, email, 'otp_auth']
      );
      user = insertRes.rows[0];
    }

    const secret = process.env.JWT_SECRET || 'speed_super_secret_key_2026';
    const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '30d' });

    res.json({ ok: true, token, user });
  } catch (err) {
    console.error('[AUTH VERIFY CODE]', err);
    res.status(500).json({ error: 'Ошибка авторизации на сервере.' });
  }
});

// 3. Проверка текущей сессии
router.get('/me', authMiddleware, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
