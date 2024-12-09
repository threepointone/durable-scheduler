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
    // // we haven't implemented this yet
    // payload: z.record(z.any()).optional(),
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
    //       id: z.string(),
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
  async onRequest(request: Request) {
    const name = this.name;
    const schedulerId = this.env.Scheduler.idFromName(name);
    const scheduler = this.env.Scheduler.get(schedulerId);

    const url = new URL(request.url);

    if (url.pathname.endsWith("/api/get-todos") && request.method === "GET") {
      const todos = await scheduler.query();
      return new Response(JSON.stringify(todos));
    }

    if (url.pathname.endsWith("/api/add-todo") && request.method === "POST") {
      const todo = taskSchema.parse(await request.json()) satisfies RawTask;
      const task = await scheduler.scheduleTask(todo);
      return new Response(JSON.stringify(task));
    }

    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    // reroute vite dev server requests to the client
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/parties/")) {
      return fetch(request.url.replace("http://localhost:8787", "http://localhost:5173"), request);
    }

    switch (`${request.method} ${url.pathname}`) {
      // TODO: move this into the durable object
      case "POST /api/string-to-schedule": {
        const openai = createOpenAI({
          apiKey: env.OPENAI_API_KEY,
        });

        const result = await generateObject({
          model: openai("gpt-4o"),
          mode: "json",
          schemaName: "task",
          schemaDescription: "A task to be scheduled",
          schema: taskSchema,
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
    }

    return (await routePartykitRequest(request, env)) || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
