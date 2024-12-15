import { createOpenAI } from "@ai-sdk/openai";
import { CoreMessage, generateObject, generateText, tool } from "ai";
// import { EmailMessage } from "cloudflare:email";
import * as mathjs from "mathjs";
import { createMimeMessage } from "mimetext";
import { Server, routePartykitRequest } from "partyserver";
import { z } from "zod";

import { Scheduler, Task, type RawTask } from "../../../src";

export { Scheduler };

type Env = {
  OPENAI_API_KEY: string;
  AI_GATEWAY_URL: string;
  AI_GATEWAY_TOKEN: string;
  AI: Ai;
  Scheduler: DurableObjectNamespace<Scheduler<Env>>;
  ToDos: DurableObjectNamespace<ToDos>;
  SendEmail: SendEmail;
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
    baseURL: this.env.AI_GATEWAY_URL,
    headers: {
      Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
      "cf-aig-authorization": `Bearer ${this.env.AI_GATEWAY_TOKEN}`,
    },
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

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        todo_id TEXT,
        messages TEXT,        
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);
  }

  async runTask(task: Task, previousMessages: CoreMessage[] = []) {
    const result = await generateText({
      model: this.openai("gpt-4o-2024-08-06", { structuredOutputs: true }),
      // toolChoice: "required",
      messages: previousMessages,
      tools: {
        calculate: tool({
          description:
            "A tool for evaluating mathematical expressions. " +
            "Example expressions: " +
            "'1.2 * (2 + 4.5)', '12.7 cm to inch', 'sin(45 deg) ^ 2'.",
          parameters: z.object({ expression: z.string() }),
          execute: async ({ expression }) => {
            console.log("evaluating", expression);
            return mathjs.evaluate(expression) as number;
          },
        }),

        generate_random_number: tool({
          description: "A tool for generating a random number.",
          parameters: z.object({ min: z.number(), max: z.number() }),
          execute: async ({ min, max }) => {
            const number = Math.floor(Math.random() * (max - min + 1)) + min;
            console.log("generating random number", number);
            return number;
          },
        }),

        send_email: tool({
          description: "A tool for sending an email.",
          parameters: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
          execute: async ({ to, subject, body }) => {
            console.log("sending email", to, subject, body);

            // const msg = createMimeMessage();
            // msg.setSender({ name: "GPT-4", addr: "spai@cloudflare.com" });
            // msg.setRecipient(to);
            // msg.setSubject(subject);
            // msg.addMessage({
            //   contentType: "text/plain",
            //   data: body,
            // });

            return "Email sent";
          },
        }),
        // answer tool: the LLM will provide a structured answer

        // ask_user: tool({
        //   description: "A tool for asking the user a question and getting a response.",
        //   parameters: z.object({ question: z.string() }),
        //   // execute: async ({ question }) => {
        //   //   return question;
        //   // },
        // }),

        answer: tool({
          description: "A tool for providing the final answer.",
          parameters: z.object({
            steps: z.array(
              z.object({
                calculation: z.string(),
                reasoning: z.string(),
              })
            ),
            answer: z.string(),
          }),
          // no execute function - invoking it will terminate the agent
        }),
      },
      // maxRetries: 3,
      maxSteps: 10,
      // onStepFinish({ text, toolCalls, toolResults, finishReason, usage }) {
      //   // your own logic, e.g. for saving the chat history or recording usage
      //   console.log("step finished");
      //   // console.log(text);
      //   // console.log(toolCalls);
      //   // console.log(toolResults);
      //   // console.log(finishReason);
      //   // console.log(usage);
      // },
      system: `
        You are a helpful assistant. You are given a task to complete. You can ignore anything time related (like dates, times, etc.) Just do the task. If you cannot do the task, apologize and say you cannot do the task. The task is: ${task.description}
        `,

      // prompt: `Ask the user for 2 random numbers between 1 and 100. Add them together and return the result.`,
    });

    const messages = result.response.messages;
    console.dir(messages, { depth: null });
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (todo_id, messages) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET messages = ?`,
      task.id,
      JSON.stringify(messages),
      JSON.stringify(messages)
    );
    this.broadcast("refresh");
    return messages;
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

      case "GET /api/get-messages": {
        const messages = this.ctx.storage.sql.exec(`SELECT * FROM messages`).raw().toArray() as [
          string, // id
          string, // todo_id
          string, // messages
        ][];
        return new Response(
          JSON.stringify(
            messages.map(([id, todo_id, messages]) => ({
              id,
              todo_id,
              messages: JSON.parse(messages),
            }))
          )
        );
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
            function: "runTask",
          },
        });

        return new Response(JSON.stringify(task));
      }
      case "POST /api/remove-todo": {
        const { id } = (await request.json()) satisfies { id: string };
        const task = await scheduler.cancelTask(id);
        this.ctx.storage.sql.exec(`DELETE FROM messages WHERE todo_id = ?`, id);
        return new Response(JSON.stringify(task));
      }

      case "POST /api/do-todo": {
        const { id, messages = [] } = (await request.json()) satisfies {
          id: string;
          messages: CoreMessage[];
        };
        console.log({ id, messages });
        const task = (await scheduler.query({ id }))[0] as Task;
        console.log("task", task);
        const result = await this.runTask(task, messages);
        return new Response(JSON.stringify(result));
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
  // async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
  //   // get
  // },
} satisfies ExportedHandler<Env>;
