'use strict';
class AppError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function requireRole(user, role) {
  if (!user) throw new AppError(401, 'UNAUTHORIZED');
  if (user.role !== role) throw new AppError(403, 'FORBIDDEN');
}
module.exports = { AppError, requireRole };
