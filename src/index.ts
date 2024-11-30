import { DurableObject } from "cloudflare:workers";
import cronParser from "cron-parser";

export type Task = {
  id: string;
  name?: string | undefined;
  payload: Record<string, unknown>;
} & (
    | {
      time: Date;
      type: "scheduled";
    }
    | {
      delay: number;
      type: "delayed";
    }
    | {
      cron: string;
      type: "cron";
    }
  );

type SqlTask = {
  id: string;
  name: string | null;
  type: string | null;
  payload: string | null;
  time: number | null;
  delay: number | null;
  cron: string | null;
  created_at: number | null;
}

export class Scheduler<Env> extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void this.ctx.blockConcurrencyWhile(async () => {
      // Create tasks table if it doesn't exist
      this.ctx.storage.sql.exec(
        `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT NOT NULL,
        payload TEXT,
        time INTEGER,
        delay INTEGER,
        cron TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `
      );

      // Schedule the next task if any exist
      await this.scheduleNextAlarm();
    });
  }

  status() {
    return {
      status: "reachable" as const,
      timestamp: Date.now(),
      diskUsage: this.ctx.storage.sql.databaseSize,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async fetch(_request: Request): Promise<Response> {
    return new Response("Hello World!");
  }

  getAllTasks() {
    // return entire database
    return this.querySql<SqlTask>([{ sql: "SELECT * FROM tasks" }]);
  }

  private async scheduleNextAlarm() {
    // Find the next task that needs to be executed
    const query = `
      SELECT time FROM tasks 
      WHERE time > ? 
      ORDER BY time ASC 
      LIMIT 1
    `;
    const { result } = this.querySql<SqlTask>([{ sql: query, params: [Math.floor(Date.now() / 1000)] }])
    if (!result) return;

    if (result.length > 0 && "time" in result[0]) {
      const nextTime = new Date((result[0].time as number) * 1000);
      await this.ctx.storage.setAlarm(nextTime);
    }
  }

  async scheduleTask(task: Task): Promise<Task> {
    const { id } = task;
    const payload = JSON.stringify(task.payload);

    if ("time" in task && task.time) {
      const timestamp = Math.floor(task.time.getTime() / 1000);
      const query = `
        INSERT OR REPLACE INTO tasks (id, name, type, payload, time)
        VALUES (?, ?, 'scheduled', ?, ?)
      `;
      this.querySql([{ sql: query, params: [id, task.name || null, payload, timestamp] }])

      await this.scheduleNextAlarm();

      return {
        id,
        name: task.name,
        payload: task.payload,
        time: task.time,
        type: "scheduled",
      };
    } else if ("delay" in task && task.delay) {
      const time = new Date(Date.now() + task.delay);
      const timestamp = Math.floor(time.getTime() / 1000);
      const query = `
        INSERT OR REPLACE INTO tasks (id, name, type, payload, delay, time)
        VALUES (?, ?, 'delayed', ?, ?, ?)
      `;

      this.querySql([{ sql: query, params: [id, task.name || null, payload, task.delay, timestamp] }])

      await this.scheduleNextAlarm();

      return {
        id,
        name: task.name,
        payload: task.payload,
        delay: task.delay,
        type: "delayed",
      };
    } else if ("cron" in task && task.cron) {
      const nextExecutionTime = this.getNextCronTime(task.cron);
      const timestamp = Math.floor(nextExecutionTime.getTime() / 1000);
      const query = `
        INSERT OR REPLACE INTO tasks (id, name, type, payload, cron, time)
        VALUES (?, ?, 'cron', ?, ?, ?)
      `;
      this.querySql([{ sql: query, params: [id, task.name || null, payload, task.cron, timestamp] }])

      await this.scheduleNextAlarm();

      return {
        id,
        name: task.name,
        payload: task.payload,
        cron: task.cron,
        type: "cron",
      };
    }

    throw new Error("Invalid task configuration");
  }

  async alarm(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Get all tasks that should be executed now
    const { result: tasks } = this.querySql<SqlTask>([{ sql: "SELECT * FROM tasks WHERE time <= ?", params: [now] }])

    for (const row of (tasks || [])) {
      const task = this.rowToTask(row);
      await this.executeTask(task);

      if (task.type === "cron") {
        // Update next execution time for cron tasks
        const nextExecutionTime = this.getNextCronTime(task.cron);
        const nextTimestamp = Math.floor(nextExecutionTime.getTime() / 1000);

        this.querySql([{ sql: "UPDATE tasks SET time = ? WHERE id = ?", params: [nextTimestamp, task.id] }])
      } else {
        // Delete one-time tasks after execution
        this.querySql([{ sql: "DELETE FROM tasks WHERE id = ?", params: [task.id] }])
      }
    }

    // Schedule the next alarm
    await this.scheduleNextAlarm();
  }

  private rowToTask(row: SqlTask): Task {
    const base = {
      id: row.id,
      name: row.name,
      payload: JSON.parse(row.payload as string) as Record<string, unknown>, // TODO: should probably parse/validate this
    } as Task;

    switch (row.type) {
      case "scheduled":
        return {
          ...base,
          time: new Date((row.time as number) * 1000),
          type: "scheduled",
        };
      case "delayed":
        return {
          ...base,
          delay: row.delay as number,
          type: "delayed",
        };
      case "cron":
        return {
          ...base,
          cron: row.cron as string,
          type: "cron",
        };
      default:
        throw new Error(`Unknown task type: ${row.type as string}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async executeTask(task: Task): Promise<void> {
    // This is where you would implement the actual task execution
    // eslint-disable-next-line no-console
    console.log(`Executing task ${task.id}:`, task);
  }

  private getNextCronTime(cronExpression: string): Date {
    const interval = cronParser.parseExpression(cronExpression);
    return interval.next().toDate();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async query(
    criteria: {
      name?: string;
      id?: string;
      timeRange?: { start?: Date; end?: Date };
    } = {}
  ): Promise<Task[]> {
    let query = "SELECT * FROM tasks WHERE 1=1";
    const params: SqliteParams[] = [];

    if (criteria.id) {
      query += " AND id = ?";
      params.push(criteria.id);
    }

    if (criteria.name) {
      query += " AND name = ?";
      params.push(criteria.name);
    }

    if (criteria.timeRange) {
      query += " AND time >= ? AND time <= ?";
      const start = criteria.timeRange.start || new Date(0);
      const end = criteria.timeRange.end || new Date(999999999999999);
      params.push(Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000));
    }

    const { result } = this.querySql<SqlTask>([{ sql: query, params }])
    return result?.map((row) => this.rowToTask(row)) || [];
  }

  async cancelTask(id: string): Promise<boolean> {
    const query = "DELETE FROM tasks WHERE id = ?";
    this.querySql([{ sql: query, params: [id] }])

    await this.scheduleNextAlarm();
    return true;
  }

  querySql<T>(qs: SqliteQuery[], isRaw = false): QueueResult<T> {
    try {
      if (!qs.length) {
        throw new Error("No query found to run");
      }

      const queries =
        qs?.map((item) => {
          const { sql, params } = item;
          if (!sql?.trim()) {
            throw new Error("Empty 'sql' field in transaction");
          }
          return { sql, params };
        }) || [];


      let result: QueryResponse<T> | QueryResponse<T>[];

      if (queries.length > 1) {
        result = this.executeTransaction<T>(queries, isRaw);
      } else {
        const [query] = queries;
        result = this.executeQuery<T>(query.sql, query.params, isRaw);
      }

      return {
        error: null,
        status: 200,
        result: result as T[],
      }
    } catch (error) {
      return {
        result: null,
        error: (error as Error).message ?? "Operation failed.",
        status: 500,
      }
    }
  }

  private executeTransaction<T>(queries: { sql: string; params?: SqliteParams[] }[], isRaw: boolean): QueryResponse<T>[] {
    return this.ctx.storage.transactionSync(() => {
      const results: QueryResponse<T>[] = [];

      try {
        for (const queryObj of queries) {
          const { sql, params } = queryObj;
          const result = this.executeQuery<T>(sql, params, isRaw);
          results.push(result);
        }

        return results;
      } catch (error) {
        throw error;
      }
    });
  }

  executeQuery<T>(sql: string, params: SqliteParams[] | undefined, isRaw: boolean): QueryResponse<T> {
    try {
      const cursor = params?.length ? this.ctx.storage.sql.exec(sql, ...params) : this.ctx.storage.sql.exec(sql);

      let result: QueryResponse<T>;

      if (isRaw) {
        result = {
          columns: cursor.columnNames,
          rows: (cursor.raw() as any).toArray() as T[],
          meta: {
            rows_read: cursor.rowsRead,
            rows_written: cursor.rowsWritten,
          },
        };
      } else {
        result = cursor.toArray() as T[];
      }

      return result;
    } catch (error) {
      throw error;
    }
  }

}


export type QueueResult<T> =
  | {
    result: T[];
    error: null;
    status: 200;
  }
  | {
    result: null;
    error: string;
    status: 500 | 408;
  };

export type RawSqliteResponse<T> = {
  columns: string[];
  rows: T[];
  meta: {
    rows_read: number;
    rows_written: number;
  };
};

type QueryResponse<T> = T[] | RawSqliteResponse<T>;

export type SqliteParams = number | string | boolean | null;
export type SqliteQuery = {
  sql?: string;
  params?: SqliteParams[];
};
