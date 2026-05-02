import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workflowsTable } from "./workflows";

export const executionsTable = pgTable("executions", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => workflowsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  triggeredBy: text("triggered_by").notNull().default("manual"),
  errorMessage: text("error_message"),
  nodeResults: jsonb("node_results").notNull().default([]),
  pid: integer("pid"),
});

export const logLinesTable = pgTable("log_lines", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull().references(() => executionsTable.id, { onDelete: "cascade" }),
  nodeId: text("node_id"),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExecutionSchema = createInsertSchema(executionsTable);
export type InsertExecution = z.infer<typeof insertExecutionSchema>;
export type Execution = typeof executionsTable.$inferSelect;

export const insertLogLineSchema = createInsertSchema(logLinesTable);
export type InsertLogLine = z.infer<typeof insertLogLineSchema>;
export type LogLine = typeof logLinesTable.$inferSelect;
