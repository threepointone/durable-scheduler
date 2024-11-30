export default {
  version: 0,
  name: "create_tasks_table",
  sql: `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT NOT NULL,
    payload TEXT,
    time INTEGER,
    delay INTEGER,
    cron TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  `,
};
