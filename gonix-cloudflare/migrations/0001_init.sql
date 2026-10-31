-- Base de datos de un único usuario; SIN credenciales ni números telefónicos.
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  recurrence TEXT NOT NULL CHECK (recurrence IN ('none', 'daily', 'weekly')),
  zone TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS call_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id INTEGER NOT NULL,
  due_key TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  state TEXT NOT NULL,
  call_sid TEXT,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(reminder_id, due_key)
);
CREATE INDEX IF NOT EXISTS idx_events_day ON call_events(day_utc);
