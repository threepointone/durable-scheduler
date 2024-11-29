import { Scheduler } from "../../../src";
import { z } from "zod";

type Env = {
  AI: Ai;
  SCHEDULER: DurableObjectNamespace<MyScheduler>;
};

const taskSchema = z
  .object({
    id: z.string().default(() => crypto.randomUUID()),
    name: z.string().optional(),
    payload: z.record(z.any()).default({}),
  })
  .and(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("scheduled"),
        time: z.coerce.date(),
      }),
      z.object({
        type: z.literal("delayed"),
        delay: z.number(),
      }),
      z.object({
        type: z.literal("cron"),
        cron: z.string(),
      }),
    ])
  );

// function assert(condition: boolean, message: string): asserts condition {
//   if (!condition) throw new Error(message);
// }

export class MyScheduler extends Scheduler<Env> {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return fetch(
        request.url.replace("http://localhost:8787", "http://localhost:5173"),
        request
      );
    }

    const route = `${request.method} ${url.pathname}`;

    switch (route) {
      case "GET /api/":
        return new Response("Hello, world!");

      case "GET /api/string-to-schedule": {
        const result = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          prompt: `
            You are a helpful assistant. Today is ${new Date().toUTCString()}.
            You are given a string that has to be input as an object into a scheduler.
            The string may be: 
            - a delay like "in 10 minutes"
              - you need to convert this into an object with a delay property like 
              { 
                "type": "delayed",
                "delay": 600000 
              }
            - a specific time like "next monday at 10:00"
              - you need to convert this into an object with a time property with a UTC timestamp like 
              { 
                "type": "scheduled",
                "time": "Mon, 02 Dec 2024 10:00:00 GMT"
              }
            - a cron expression like "every 10 minutes"
              - you need to convert this into an object with a cron property like 
              { 
                "type": "cron",
                "cron": "*/10 * * * *"
              }
            
            Here is the input string:
            ${url.searchParams.get("input")}

            Do not include any other text than the json object.
            `,
        });

        // @ts-expect-error
        console.log(result.response);
        // @ts-expect-error
        return new Response(result.response as string);
      }

      case "GET /api/tasks": {
        const tasks = await this.query();
        return new Response(JSON.stringify(tasks));
      }

      case "POST /api/tasks": {
        const task = taskSchema.parse(await request.json());
        await this.scheduleTask(task);
        return new Response(JSON.stringify(task));
      }

      default:
        return new Response("Not found", { status: 404 });
    }
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return fetch(
        request.url.replace("http://localhost:8787", "http://localhost:5173"),
        request
      );
    }

    const id = env.SCHEDULER.idFromName("example");
    const stub = env.SCHEDULER.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
