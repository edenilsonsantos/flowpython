import { pgTable, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workflowsTable = pgTable("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(false),
  tags: text("tags").array().notNull().default([]),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedSnapshot: jsonb("published_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const nodesTable = pgTable("nodes", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => workflowsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  label: text("label").notNull(),
  positionX: integer("position_x").notNull().default(0),
  positionY: integer("position_y").notNull().default(0),
  config: jsonb("config").notNull().default({}),
  retryCount: integer("retry_count").notNull().default(0),
  retryDelayMs: integer("retry_delay_ms").notNull().default(1000),
  continueOnError: boolean("continue_on_error").notNull().default(false),
  stopOnError: boolean("stop_on_error").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const edgesTable = pgTable("edges", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => workflowsTable.id, { onDelete: "cascade" }),
  sourceNodeId: text("source_node_id").notNull(),
  targetNodeId: text("target_node_id").notNull(),
  sourceHandle: text("source_handle"),
  label: text("label"),
  condition: text("condition"),
});

export const insertWorkflowSchema = createInsertSchema(workflowsTable).omit({ createdAt: true, updatedAt: true });
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflowsTable.$inferSelect;

export const insertNodeSchema = createInsertSchema(nodesTable).omit({ createdAt: true, updatedAt: true });
export type InsertNode = z.infer<typeof insertNodeSchema>;
export type Node = typeof nodesTable.$inferSelect;

export const insertEdgeSchema = createInsertSchema(edgesTable);
export type InsertEdge = z.infer<typeof insertEdgeSchema>;
export type Edge = typeof edgesTable.$inferSelect;
