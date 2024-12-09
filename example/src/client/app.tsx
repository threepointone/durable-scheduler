import { useState } from "react";

import { SqlTask } from "../../../src";

interface ToDo {
  id: string;
  inputText: string;
  parsedTask: SqlTask | undefined;
  completed: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ROOM_ID = "username"; // TODO: this will read a username from auth later

export default function App() {
  const [todos, setTodos] = useState<ToDo[]>([]);
  const [inputText, setInputText] = useState("");

  const handleAddToDo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    try {
      const newToDo: ToDo = {
        id: crypto.randomUUID(),
        inputText,
        parsedTask: undefined,
        completed: false,
      };

      setTodos((prev) => [...prev, newToDo]);
      // TODO: Schedule the task and update the task with the parsedTask

      // let's first convert it to the object that the scheduler expects
      const result = await fetch("/api/string-to-schedule", {
        method: "POST",
        body: inputText,
      });
      const parsedTask = await result.json();
      // eslint-disable-next-line no-console
      console.log("parsedTask", parsedTask);
      // ok now let's schedule it

      // TODO: schedule the task
      setInputText("");
    } catch (error) {
      console.error("Failed to parse todo:", error);
      // You might want to show an error message to the user here
    }
  };

  const handleToggleToDo = async (todoId: string) => {
    setTodos((prev) =>
      prev.map((todo) => (todo.id === todoId ? { ...todo, completed: !todo.completed } : todo))
    );
  };

  const handleDeleteToDo = async (todoId: string) => {
    // TODO: Cancel the scheduled task
    setTodos((prev) => prev.filter((todo) => todo.id !== todoId));
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">ToDo List</h1>

        <form onSubmit={(e) => void handleAddToDo(e)} className="mb-8">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Add a todo (e.g., 'Buy milk tomorrow at 10am')"
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Add ToDo
            </button>
          </div>
        </form>

        <div className="space-y-4">
          {todos.map((todo) => (
            <div key={todo.id} className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => void handleToggleToDo(todo.id)}
                className="h-5 w-5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <div className="flex-1">
                <p className={`text-gray-800 ${todo.completed ? "line-through" : ""}`}>
                  {todo.parsedTask?.description}
                </p>
                <p className="text-sm text-gray-500">Due: {todo.parsedTask?.time}</p>
              </div>
              <button
                onClick={() => void handleDeleteToDo(todo.id)}
                className="p-2 text-red-500 hover:text-red-600 focus:outline-none"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
