require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { init, pool } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health-check — safe to visit in a browser to diagnose connection issues
app.get('/health', async (_req, res) => {
  const vars = ['PGHOST', 'PGUSER', 'PGDATABASE', 'PGPORT'];
  const missing = vars.filter(v => !process.env[v] && !process.env[`AZURE_POSTGRESQL_${v.replace('PG', '')}`]);
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', missing_vars: missing });
  } catch (err) {
    res.status(503).json({ status: 'error', db: err.message, missing_vars: missing });
  }
});

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/lists',    require('./routes/lists'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/classes',  require('./routes/classes'));
app.use('/api/admin',    require('./routes/admin'));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Always start the HTTP server — a DB error should not make the process die.
// Azure shows "Application Error" when the process exits before binding a port.
app.listen(PORT, () => console.log(`Quiz'Efrei running on port ${PORT}`));

// Init DB after the server is already listening so the port is bound immediately.
init()
  .then(() => console.log('Database schema ready'))
  .catch(err => {
    const host = process.env.PGHOST || process.env.AZURE_POSTGRESQL_HOST || '(not set)';
    console.error(`Database init failed (host: ${host}):`, err.message);
    console.error('Set PGHOST, PGUSER, PGPASSWORD, PGDATABASE in Azure App Settings → Configuration');
  });
