import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const variablesTable = pgTable("variables", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  type: text("type").notNull().default("string"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVariableSchema = createInsertSchema(variablesTable).omit({ createdAt: true, updatedAt: true });
export type InsertVariable = z.infer<typeof insertVariableSchema>;
export type Variable = typeof variablesTable.$inferSelect;
