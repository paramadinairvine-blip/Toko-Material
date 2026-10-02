const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Validasi JWT_SECRET di production
if (process.env.NODE_ENV === 'production') {
  const unsafeSecrets = ['your-super-secret-jwt-key-change-this', 'secret', 'jwt-secret', ''];
  if (!process.env.JWT_SECRET || unsafeSecrets.includes(process.env.JWT_SECRET)) {
    console.error('❌ ERROR: JWT_SECRET tidak aman! Ganti dengan secret yang kuat sebelum deploy ke production.');
    process.exit(1);
  }
}

const { errorHandler } = require('./middlewares/errorHandler');
const routes = require('./routes');
const { startDailyReportJob } = require('./jobs/dailyReport.job');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ─────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP agar frontend SPA bisa jalan
  crossOriginEmbedderPolicy: false,
}));

// CORS — batasi origin
const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5000',
  'https://material-pesantren.vercel.app',
  'https://frontend-one-bice-78.vercel.app',
  'https://pos-one-ruddy.vercel.app',
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : defaultOrigins;

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Rate limiting — global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 500,
  message: { success: false, message: 'Terlalu banyak request, coba lagi nanti' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

// Rate limiting — login (lebih ketat)
// Hanya /auth/login. /auth/refresh dipanggil rutin oleh tiap klien karena access token
// berumur pendek, jadi tidak boleh ikut menghabiskan jatah percobaan login.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 20,
  message: { success: false, message: 'Terlalu banyak percobaan login, coba lagi dalam 15 menit' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);

// ─── Compression ────────────────────────────────────
app.use(compression());

// ─── Body Parser ─────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


// API Routes
app.use('/api', routes);

// Global error handler
app.use(errorHandler);

// Only start server when not in test mode (supertest handles it)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Start scheduled jobs
    startDailyReportJob();
  });
}

module.exports = app;
