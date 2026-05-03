import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const aiProvidersTable = pgTable("ai_providers", {
  id: text("id").primaryKey(),
  apiKey: text("api_key").notNull().default(""),
  model: text("model").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiProvider = typeof aiProvidersTable.$inferSelect;
