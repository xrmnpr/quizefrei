import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import listsRoutes from './routes/lists.routes.js';
import classesRoutes from './routes/classes.routes.js';
import quizzesRoutes from './routes/quizzes.routes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: "Quiz'Efrei" });
});

app.use('/api/auth', authRoutes);
app.use('/api/lists', listsRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/quizzes', quizzesRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route introuvable.' });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    message: error.message || 'Erreur serveur.'
  });
});

app.listen(port, () => {
  console.log(`Backend Quiz'Efrei lancé sur http://localhost:${port}`);
});
