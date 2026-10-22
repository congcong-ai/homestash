import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import type {
  InventoryItem,
  InventoryEvent,
  Repository,
  Location,
} from "@homestash/domain";
const items = sqliteTable("inventory_items", {
  id: text("id").primaryKey(),
  data: text("data", { mode: "json" }).$type<InventoryItem>().notNull(),
});
const events = sqliteTable("inventory_events", {
  id: text("id").primaryKey(),
  data: text("data", { mode: "json" }).$type<InventoryEvent>().notNull(),
});
const state = sqliteTable("app_state", {
  id: text("id").primaryKey(),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
});
export class SQLiteRepository implements Repository {
  readonly sqlite;
  readonly db;
  constructor(path: string) {
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.db = drizzle(this.sqlite);
    this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)",
    );
    if (
      !this.sqlite
        .prepare("SELECT version FROM schema_migrations WHERE version = 1")
        .get()
    )
      this.sqlite.transaction(() =>
        this.sqlite.exec(
          readFileSync(
            new URL("../migrations/0001_initial.sql", import.meta.url),
            "utf8",
          ),
        ),
      )();
  }
  list() {
    return this.db
      .select()
      .from(items)
      .all()
      .map((r) => r.data);
  }
  get(id: string) {
    return this.db.select().from(items).where(eq(items.id, id)).get()?.data;
  }
  save(item: InventoryItem, event: InventoryEvent) {
    this.transaction(() => {
      this.db
        .insert(items)
        .values({ id: item.id, data: item })
        .onConflictDoUpdate({ target: items.id, set: { data: item } })
        .run();
      this.db.insert(events).values({ id: event.id, data: event }).run();
    });
  }
  events() {
    return this.db
      .select()
      .from(events)
      .all()
      .map((r) => r.data);
  }
  locations(): Location[] {
    return this.sqlite
      .prepare("SELECT id, household_id as householdId, name FROM locations")
      .all() as Location[];
  }
  saveLocation(location: Location) {
    this.sqlite
      .prepare(
        "INSERT INTO locations(id,household_id,name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
      )
      .run(location.id, location.householdId, location.name);
  }
  transaction<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)();
  }
  read<T>(id: string, fallback: T): T {
    return (
      (this.db.select().from(state).where(eq(state.id, id)).get()?.data as T) ??
      fallback
    );
  }
  write(id: string, data: unknown) {
    this.db
      .insert(state)
      .values({ id, data })
      .onConflictDoUpdate({ target: state.id, set: { data } })
      .run();
  }
  close() {
    this.sqlite.close();
  }
}
