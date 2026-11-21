const requireFounder = (req, res, next) => {
  if (!req.user || req.user.role !== 'founder') {
    return res.status(403).json({ error: 'Доступ разрешён только Основателю SPEED.' });
  }
  next();
};

const requireAdminOrFounder = (req, res, next) => {
  if (!req.user || !['admin', 'founder'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Недостаточно прав администратора.' });
  }
  next();
};

module.exports = { requireFounder, requireAdminOrFounder };