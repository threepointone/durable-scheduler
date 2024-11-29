import { DurableObject } from "cloudflare:workers";

import cronParser from "cron-parser";

export type Task = {
  id: string;
  name?: string | undefined;
  payload: any;
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

export class Scheduler<Env> extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.blockConcurrencyWhile(async () => {
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

  async fetch(_request: Request): Promise<Response> {
    return new Response("Hello World!");
  }

  getAllTasks() {
    // return entire database
    return this.ctx.storage.sql.exec("SELECT * FROM tasks").toArray();
  }

  private async scheduleNextAlarm() {
    // Find the next task that needs to be executed
    const result = this.ctx.storage.sql
      .exec(
        `
      SELECT time FROM tasks 
      WHERE time > ? 
      ORDER BY time ASC 
      LIMIT 1
    `,
        Math.floor(Date.now() / 1000)
      )
      .toArray();

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
      this.ctx.storage.sql.exec(
        `
        INSERT OR REPLACE INTO tasks (id, name, type, payload, time)
        VALUES (?, ?, 'scheduled', ?, ?)
      `,
        id,
        task.name,
        payload,
        timestamp
      );

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

      this.ctx.storage.sql.exec(
        `
        INSERT OR REPLACE INTO tasks (id, name, type, payload, delay, time)
        VALUES (?, ?, 'delayed', ?, ?, ?)
      `,

        id,
        task.name,
        payload,
        task.delay,
        timestamp
      );

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

      this.ctx.storage.sql.exec(
        `
        INSERT OR REPLACE INTO tasks (id, name, type, payload, cron, time)
        VALUES (?, ?, 'cron', ?, ?, ?)
      `,
        id,
        task.name,
        payload,
        task.cron,
        timestamp
      );

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
    const tasks = this.ctx.storage.sql.exec(
      `
      SELECT * FROM tasks 
      WHERE time <= ?
    `,
      now
    );

    for (const row of tasks) {
      const task = this.rowToTask(row);
      await this.executeTask(task);

      if (task.type === "cron") {
        // Update next execution time for cron tasks
        const nextExecutionTime = this.getNextCronTime(task.cron);
        const nextTimestamp = Math.floor(nextExecutionTime.getTime() / 1000);

        this.ctx.storage.sql.exec(
          `
          UPDATE tasks 
          SET time = ? 
          WHERE id = ?
        `,
          nextTimestamp,
          task.id
        );
      } else {
        // Delete one-time tasks after execution
        this.ctx.storage.sql.exec(
          `
          DELETE FROM tasks 
          WHERE id = ?
        `,
          task.id
        );
      }
    }

    // Schedule the next alarm
    await this.scheduleNextAlarm();
  }

  private rowToTask(row: Record<string, any>): Task {
    const base = {
      id: row.id,
      name: row.name,
      payload: JSON.parse(row.payload),
    };

    switch (row.type) {
      case "scheduled":
        return {
          ...base,
          time: new Date(row.time * 1000),
          type: "scheduled",
        };
      case "delayed":
        return {
          ...base,
          delay: row.delay,
          type: "delayed",
        };
      case "cron":
        return {
          ...base,
          cron: row.cron,
          type: "cron",
        };
      default:
        throw new Error(`Unknown task type: ${row.type}`);
    }
  }

  private async executeTask(task: Task): Promise<void> {
    // This is where you would implement the actual task execution
    console.log(`Executing task ${task.id}:`, task);
  }

  private getNextCronTime(cronExpression: string): Date {
    const interval = cronParser.parseExpression(cronExpression);
    return interval.next().toDate();
  }

  async query(
    criteria: {
      name?: string;
      id?: string;
      timeRange?: { start?: Date; end?: Date };
    } = {}
  ): Promise<Task[]> {
    let query = "SELECT * FROM tasks WHERE 1=1";
    const params: any[] = [];

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
      params.push(
        Math.floor(start.getTime() / 1000),
        Math.floor(end.getTime() / 1000)
      );
    }

    const result = this.ctx.storage.sql.exec(query, ...params).toArray();
    return result.map((row) => this.rowToTask(row));
  }

  async cancelTask(id: string): Promise<boolean> {
    this.ctx.storage.sql.exec(
      `
      DELETE FROM tasks 
      WHERE id = ?
    `,
      id
    );

    await this.scheduleNextAlarm();
    return true;
  }
}
