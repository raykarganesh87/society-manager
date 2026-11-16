import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import schema from "./schema.sql?raw";
import { readFile, writeFile } from "../lib/storage";

const DB_FILE = "society.db";
const SAFETY_FILE = "society.before-restore.db";

type Param = string | number | null;
let SQL: SqlJsStatic;
let db: Database;

function prepare(d: Database) {
  d.run("PRAGMA foreign_keys = ON");
  d.exec(schema);
}

export async function openDb(): Promise<void> {
  SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const bytes = await readFile(DB_FILE);
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  prepare(db);
  await save();
}

/** Write the database to device storage. Called after every change. */
export async function save(): Promise<void> {
  const bytes = db.export();
  db.run("PRAGMA foreign_keys = ON"); // export() resets this setting
  await writeFile(DB_FILE, bytes);
}

export function all<T = Record<string, Param>>(sql: string, params: Param[] = []): T[] {
  const st = db.prepare(sql);
  st.bind(params);
  const out: T[] = [];
  while (st.step()) out.push(st.getAsObject() as T);
  st.free();
  return out;
}
export const one = <T = Record<string, Param>>(sql: string, params: Param[] = []) => all<T>(sql, params)[0] ?? null;
export const run = (sql: string, params: Param[] = []) => db.run(sql, params);
export const lastId = () => (one<{ id: number }>("SELECT last_insert_rowid() AS id") as { id: number }).id;

export function tx<T>(fn: () => T): T {
  db.run("BEGIN");
  try {
    const r = fn();
    db.run("COMMIT");
    return r;
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

export const exportBytes = () => {
  const b = db.export();
  db.run("PRAGMA foreign_keys = ON");
  return b;
};

/** Replace the whole database with a backup. The current data is kept as a safety copy first. */
export async function restoreBytes(bytes: Uint8Array): Promise<void> {
  const candidate = new SQL.Database(bytes);
  try {
    candidate.exec("SELECT COUNT(*) FROM societies");
  } catch {
    candidate.close();
    throw new Error("The backup does not look like Society Manager data.");
  }
  await writeFile(SAFETY_FILE, exportBytes());
  db.close();
  db = candidate;
  prepare(db);
  await save();
}

export const safetyCopyExists = async () => (await readFile(SAFETY_FILE)) !== null;

export async function undoRestore(): Promise<void> {
  const bytes = await readFile(SAFETY_FILE);
  if (!bytes) throw new Error("There is no earlier copy to go back to.");
  db.close();
  db = new SQL.Database(bytes);
  prepare(db);
  await save();
}
