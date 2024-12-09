This is an example of how to use the `durable-scheduler` package.

The example app is a TODO list app that can schedule tasks to be run at a future date. It is a client side rendered React app that uses tailwind for styling, built with Vite.

We have one input at the top-middle of the page, where you can add a new task. This takes freeform natural language text input (eg: "Buy milk tomorrow at 10am", "Send me a report every friday evening", "Remind me to call my wife in 20 minutes"). We take the input from the user, which is then parsed into a task.

Underneath the input, there is a list of all the tasks that have been scheduled. Each task has a description, a due date, and a status checkbox. We use the status checkbox to mark a task as complete. We can also delete a task altogether by clicking the delete button.
