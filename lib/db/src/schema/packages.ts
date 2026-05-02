import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workflowsTable } from "./workflows";

export const packagesTable = pgTable("packages", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => workflowsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: text("version"),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPackageSchema = createInsertSchema(packagesTable);
export type InsertPackage = z.infer<typeof insertPackageSchema>;
export type Package = typeof packagesTable.$inferSelect;
