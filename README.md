_(wip, do not use)_

## durable-scheduler

Sophisticated scheduler for durable tasks, built on Durable Object Alarms.

- schedule tasks by time, delay, or cron expression
- schedule multiple tasks on the same object
- query tasks by description or id (or by time range?)
- cancel tasks

Bonus: This will be particularly useful when wired up with an LLM agent, so you'll be able to schedule tasks by describing them in natural language. Like "remind me to call my friend every monday at 10:00"

```ts
import { Scheduler } from "durable-scheduler";

type Task = {
  id: string;
  description: string;
  time: Date;
} & (
  | {
      time: Date;
      type: "scheduled";
    }
  | {
      delayInSeconds: number;
      type: "delayed";
    }
  | {
      cron: string;
      type: "cron";
    }
);

class MyClass extends Scheduler {
  foo() {
    // schedule at specific time
    this.scheduler.scheduleTask({
      description: "my-task",
      time: new Date(Date.now() + 1000),
    });

    // schedule after a certain amount of time
    this.scheduler.scheduleTask({
      description: "my-task",
      delayInSeconds: 1000, // in ms? s?
    });

    // schedule to run periodically
    this.scheduler.scheduleTask({
      description: "my-task",
      cron: "*/1 * * * *", // every minute
    });

    // you can also specify an id
    this.scheduler.scheduleTask({
      id: "my-task",
      time: new Date(Date.now() + 1000),
    });

    // ids must be unique

    // if you don't provide an id, it will default to a random uuid
    // if you try to schedule a task with an id that already exists,
    // it will overwrite the existing task

    // query for tasks
    const tasks = this.scheduler.query({
      // by description
      // by id
      // by time range
      // some kind of sql syntax here? dunno..
    });

    // cancel a task
    tasks.forEach((task) => {
      this.scheduler.cancelTask(task.id);
    });
  }
}
```

## todo:

- replace with a decorator syntax
- add a dashboard for visualizing tasks and their status?
- what's a good api for actually running the tasks? (maybe just a simple http api? like a webhook?)
