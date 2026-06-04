require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { init } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/lists',    require('./routes/lists'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/classes',  require('./routes/classes'));
app.use('/api/admin',    require('./routes/admin'));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

init()
  .then(() => app.listen(PORT, () => console.log(`Quiz'Efrei running on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
