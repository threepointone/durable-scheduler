import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { Server, routePartykitRequest } from "partyserver";
import { z } from "zod";

import { Scheduler, type RawTask } from "../../../src";

export { Scheduler };

type Env = {
  OPENAI_API_KEY: string;
  AI: Ai;
  Scheduler: DurableObjectNamespace<Scheduler<Env>>;
  ToDos: DurableObjectNamespace<ToDos>;
};

const taskSchema = z
  .object({
    id: z.string().default(() => {
      return crypto.randomUUID();
    }),
    description: z.string().optional(),
    payload: z.record(z.any()).optional(),
    // // this isn't necessary, but it's here for reference
    // callback: z
    //   .union([
    //     z.object({
    //       type: z.literal("webhook"),
    //       url: z.string(),
    //     }),
    //     z.object({
    //       type: z.literal("durable-object"),
    //       namespace: z.string(),
    //       name: z.string(),
    //       function: z.string(),
    //     }),
    //   ])
    //   .optional(),
  })
  .and(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("scheduled"),
        time: z.coerce.date(),
      }),
      z.object({
        type: z.literal("delayed"),
        delayInSeconds: z.number(),
      }),
      z.object({
        type: z.literal("cron"),
        cron: z.string(),
      }),
      z.object({
        type: z.literal("no-schedule"),
      }),
    ])
  );

// function assert(condition: boolean, message: string): asserts condition {
//   if (!condition) throw new Error(message);
// }

export class ToDos extends Server<Env> {
  openai = createOpenAI({
    apiKey: this.env.OPENAI_API_KEY,
  });
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // this.ctx.storage.sql.exec(
    //   `CREATE TABLE IF NOT EXISTS todos (
    //     id TEXT PRIMARY KEY,
    //     input TEXT,
    //     task TEXT,
    //     completed INTEGER DEFAULT 0,
    //     created_at INTEGER DEFAULT (unixepoch())
    //   )`
    // );
  }

  async onRequest(request: Request) {
    const scheduler = this.env.Scheduler.get(this.env.Scheduler.idFromName(this.name));

    const url = new URL(request.url);

    const baseUrl = `/parties/to-dos/${this.name}`;

    switch (`${request.method} ${url.pathname.substring(baseUrl.length)}`) {
      case "GET /api/get-todos": {
        const todos = await scheduler.query();
        return new Response(JSON.stringify(todos));
      }
      case "POST /api/add-todo": {
        const todo = taskSchema.parse(await request.json()) satisfies RawTask;
        const task = await scheduler.scheduleTask({
          ...todo,
          // add a callback to this todo instance
          callback: {
            type: "durable-object",
            namespace: "ToDos",
            name: this.name,
            function: "callback",
          },
        });

        return new Response(JSON.stringify(task));
      }
      case "POST /api/remove-todo": {
        const { id } = (await request.json()) satisfies { id: string };
        const task = await scheduler.cancelTask(id);
        return new Response(JSON.stringify(task));
      }

      case "POST /api/string-to-schedule": {
        const result = await generateObject({
          model: this.openai("gpt-4o"),
          mode: "json",
          schemaName: "task",
          schemaDescription: "A task to be scheduled",
          schema: taskSchema, // <- the shape of the object that the scheduler expects
          maxRetries: 5,
          prompt: `
Today is ${new Date().toUTCString()}.
You are given a string that has to be input as an object into a scheduler.

Here is the string:
${await request.text()}
`,
        });

        return new Response(JSON.stringify(result.object));
      }

      default:
        return new Response("Not found", { status: 404 });
    }
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    // reroute vite dev server requests to the client
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/parties/")) {
      return fetch(request.url.replace("http://localhost:8787", "http://localhost:5173"), request);
    }

    return (await routePartykitRequest(request, env)) || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
