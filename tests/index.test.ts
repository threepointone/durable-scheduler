import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import cronParser from "cron-parser";
import { describe, it, expect } from "vitest";

import worker from ".";

function getStub(environment: typeof env) {
  const id = environment.SCHEDULER.idFromName("example");
  return environment.SCHEDULER.get(id);
}

describe("Hello World worker", () => {
  it("responds with Hello World!", async () => {
    const request = new Request("http://example.com");
    // Create an empty context to pass to `worker.fetch()`
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toBe("Hello World!");
  });

  it("has an empty table when it starts", async () => {
    const stub = getStub(env);
    const results = await stub.getAllTasks();
    expect(results).toEqual([]);
  });

  it("can schedule a scheduled task", async () => {
    const stub = getStub(env);
    const id = "scheduled-task-001";
    const time = new Date(Date.now() + 10000);
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const task = await stub.scheduleTask({
      id,
      name: "test",
      type: "scheduled",
      payload: {},
      time,
    });

    expect(task).toMatchInlineSnapshot(`
        {
          "id": "scheduled-task-001",
          "name": "test",
          "payload": {},
          "time": ${time.toISOString()},
          "type": "scheduled",
        }
      `);
    const timestamp = Math.floor(time.getTime() / 1000);

    const debug = await stub.getAllTasks();
    expect(debug).toHaveLength(1);

    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      created_at,
      ...rest
    } = debug[0];

    expect(rest).toMatchInlineSnapshot(`
      {
        "cron": null,
        "delay": null,
        "id": "scheduled-task-001",
        "name": "test",
        "payload": "{}",
        "time": ${timestamp},
        "type": "scheduled",
      }
    `);
  });

  it("can schedule a delayed task", async () => {
    const stub = getStub(env);
    const id = "delayed-task-001";
    const delay = 10000;
    const timestamp = new Date().getTime() + delay;
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const task = await stub.scheduleTask({
      id,
      name: "test",
      type: "delayed",
      payload: {},
      delay,
    });

    expect(task).toMatchInlineSnapshot(`
    {
      "delay": 10000,
      "id": "delayed-task-001",
      "name": "test",
      "payload": {},
      "type": "delayed",
    }
  `);

    const debug = await stub.getAllTasks();
    expect(debug).toHaveLength(1);

    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      created_at,
      ...rest
    } = debug[0];

    expect(rest).toMatchInlineSnapshot(`
      {
        "cron": null,
        "delay": 10000,
        "id": "delayed-task-001",
        "name": "test",
        "payload": "{}",
        "time": ${Math.floor(timestamp / 1000)},
        "type": "delayed",
      }
    `);
  });

  it("can schedule a cron task", async () => {
    const stub = getStub(env);
    const id = "cron-task-001";
    const cron = "0 0 * * 2";
    const next = cronParser.parseExpression(cron).next();
    const timestamp = Math.floor(next.toDate().getTime() / 1000);

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const task = await stub.scheduleTask({
      id,
      name: "test",
      type: "cron",
      payload: {},
      cron,
    });

    expect(task).toMatchInlineSnapshot(`
      {
        "cron": "0 0 * * 2",
        "id": "cron-task-001",
        "name": "test",
        "payload": {},
        "type": "cron",
      }
    `);

    const debug = await stub.getAllTasks();
    expect(debug).toHaveLength(1);

    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      created_at,
      ...rest
    } = debug[0];

    expect(rest).toMatchInlineSnapshot(`
    {
      "cron": "0 0 * * 2",
      "delay": null,
      "id": "cron-task-001",
      "name": "test",
      "payload": "{}",
      "time": ${timestamp},
      "type": "cron",
    }
  `);
  });
});
