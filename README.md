## durable-scheduler

Sophisticated scheduler for durable tasks, built on Durable Object Alarms.

- schedule tasks by time, delay, or cron expression
- schedule multiple tasks on the same object
- query tasks by name, id, or payload pattern
- cancel tasks

Bonus: This will be particularly useful when wired up with an LLM agent, so you'll be able to schedule tasks by describing them in natural language. Like "remind me to call my friend every monday at 10:00"

```ts
import { Scheduler } from "durable-scheduler";

type Task = {
  id: string;
  name: string;
  payload: any;
  time: Date;
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

class MyClass extends Scheduler {
  foo() {
    // schedule at specific time
    this.scheduler.scheduleTask({
      name: "my-task",
      time: new Date(Date.now() + 1000),
      payload: {
        // ...
      },
    });

    // schedule after a certain amount of time
    this.scheduler.scheduleTask({
      name: "my-task",
      delay: 1000, // in ms? s?
      payload: {
        // ...
      },
    });

    // schedule to run periodically
    this.scheduler.scheduleTask({
      name: "my-task",
      cron: "*/1 * * * *", // every minute
      payload: {
        // ...
      },
    });

    // you can also use an id instead of a name
    this.scheduler.scheduleTask({
      id: "my-task",
      time: new Date(Date.now() + 1000),
      payload: {
        // ...
      },
    });

    // ids must be unique
    // names can be repeated

    // if you don't provide a name or id, it will default to a random uuid
    // if you try to schedule a task with an id that already exists,
    // it will overwrite the existing task

    // query for tasks
    const tasks = this.scheduler.query({
      // by name
      // by id
      // by payload pattern matching (?)
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
