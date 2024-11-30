import { SQLMigration } from "../migrate";
import v00_create_tasks_table from "./v00_create_tasks_table";

export const migrations: SQLMigration[] = [v00_create_tasks_table] as const;
