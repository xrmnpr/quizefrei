const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: Number.parseInt(process.env.PGPORT || '5432'),
  // Azure PostgreSQL Flexible Server requires SSL
  ssl: process.env.PGHOST ? { rejectUnauthorized: false } : false
});

async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function queryOne(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0] || null;
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL CHECK(question_type IN ('multiple_choice','true_false','short_answer')),
      order_index INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS choices (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      choice_text TEXT NOT NULL,
      is_correct BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invite_code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS class_members (
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (class_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS class_lists (
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      PRIMARY KEY (class_id, list_id)
    );

    CREATE TABLE IF NOT EXISTS list_shares (
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      shared_with_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, shared_with_id)
    );

    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      time_limit INTEGER,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      score INTEGER,
      total_questions INTEGER,
      is_graded BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS quiz_responses (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      choice_id TEXT REFERENCES choices(id) ON DELETE SET NULL,
      text_answer TEXT,
      is_correct BOOLEAN
    );
  `);
}

module.exports = { query, queryOne, pool, init };
