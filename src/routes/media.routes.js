const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // до 50 МБ на файл
});

router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не выбран.' });
    }

    const mime = req.file.mimetype || '';
    let kind = 'file';
    if (mime.startsWith('image/')) kind = 'image';
    else if (mime.startsWith('video/')) kind = 'video';
    else if (mime.startsWith('audio/')) kind = 'voice';

    const fileUrl = `/uploads/${req.file.filename}`;

    res.status(201).json({
      kind,
      file_url: fileUrl,
      file_name: req.file.originalname,
      size: req.file.size,
      mime_type: mime,
    });
  } catch (err) {
    console.error('[MEDIA UPLOAD]', err);
    res.status(500).json({ error: 'Ошибка загрузки файла.' });
  }
});

module.exports = router;