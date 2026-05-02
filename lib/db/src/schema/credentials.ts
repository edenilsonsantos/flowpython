import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const credentialsTable = pgTable("credentials", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  description: text("description"),
  data: jsonb("data").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCredentialSchema = createInsertSchema(credentialsTable).omit({ createdAt: true, updatedAt: true });
export type InsertCredential = z.infer<typeof insertCredentialSchema>;
export type Credential = typeof credentialsTable.$inferSelect;
