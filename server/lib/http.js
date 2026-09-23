/** Error with an HTTP status, thrown from route handlers. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wrap an async route handler so rejections reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, _next) {
  // Postgres unique violation → 409, so callers get a useful message.
  if (err.code === '23505') return res.status(409).json({ error: 'That record already exists' });
  // Invalid UUID or other malformed input in a URL parameter.
  if (err.code === '22P02') return res.status(404).json({ error: 'Not found' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
}
