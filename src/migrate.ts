export type SQLMigration = {
  version: number;
  name: string;
  sql: string;
};

export function migrate(storage: DurableObjectStorage, migrations: SQLMigration[]) {
  createSchemaHistory(storage);
  const current = getSchema(storage);

  if (!migrations.length) {
    if (current === null) {
      return;
    }
    throw new Error("No migration and current schema is null");
  }

  const sorted = migrations.sort((a, b) => a.version - b.version);
  const latest = sorted[migrations.length - 1];

  if (latest.version < (current?.version || -1)) {
    throw new Error(`Latest schema version in migrations [${latest.name} (version: ${latest.version})] is less than the current db schema: ${current}`);
  }

  if (current && latest.version === current.version) {
    return;
  }

  const toApply = sorted.filter((m) => m.version > (current?.version || -1));
  storage.transactionSync(() => {
    for (let index = 0; index < toApply.length; index++) {
      const migration = toApply[index];
      storage.sql.exec(migration.sql);
      storage.sql.exec("INSERT INTO schema_history (version, name) VALUES (?, ?)", migration.version, migration.name);
    }
  });
}

function createSchemaHistory(storage: DurableObjectStorage) {
  storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_history (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT (DATETIME('now','subsec'))
    )
    `);
}

function getSchema(storage: DurableObjectStorage): SQLMigration | null {
  const [version] = [...storage.sql.exec("SELECT * FROM schema_history ORDER BY version DESC LIMIT 1")] as SQLMigration[];
  if (!version) {
    return null;
  }
  return version;
}
