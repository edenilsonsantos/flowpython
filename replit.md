# npython

## Overview

**npython** is a visual low-code Python automation platform inspired by n8n. It lets developers drag, drop, and connect Python code blocks on a canvas to build automations that run locally or in Docker.

## Architecture

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/npython) — dark theme, teal accents
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Flow editor**: React Flow (reactflow)
- **Code editor**: @uiw/react-codemirror + @codemirror/lang-python

## Features

- Visual workflow editor: drag-and-drop Python code blocks, connect with edges
- Node types: code, set_variable, get_variable, trigger_manual, trigger_schedule, condition, http_request, wait, note
- Node config: retry count, retry delay, continueOnError, stopOnError
- Individual node execution (test in isolation)
- Per-workflow Python venv with pip package management
- Full workflow execution engine (topological sort, sequential node execution)
- Execution history with status, duration, triggered-by
- Real-time log lines per execution and per node
- Stop running executions
- Global variables (string, number, boolean, json types)
- Credentials manager (api_key, basic_auth, oauth2, custom)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Python venv location

Each workflow gets its own venv at: `/tmp/npython-venvs/<workflowId>/`

Set `NPYTHON_VENVS_DIR` env var to change the base directory.

## API Routes

- `GET/POST /api/workflows` — list/create workflows
- `GET/PUT/DELETE /api/workflows/:id` — get/update/delete workflow
- `POST /api/workflows/:id/execute` — trigger workflow execution
- `GET /api/workflows/:id/stats` — workflow execution stats
- `GET/POST /api/workflows/:id/packages` — list/install Python packages
- `DELETE /api/workflows/:id/packages/:name` — uninstall package
- `GET/POST /api/workflows/:wfId/nodes` — list/create nodes
- `PUT/DELETE /api/workflows/:wfId/nodes/:nodeId` — update/delete node
- `POST /api/workflows/:wfId/nodes/:nodeId/execute` — test single node
- `GET /api/executions` — list executions (filterable)
- `GET /api/executions/summary` — dashboard summary stats
- `GET /api/executions/:id` — execution detail with node results
- `POST /api/executions/:id/stop` — stop a running execution
- `GET /api/executions/:id/logs` — execution log lines
- `GET/POST /api/variables` — global variables
- `PUT/DELETE /api/variables/:id` — update/delete variable
- `GET/POST /api/credentials` — credentials (values masked in responses)
- `PUT/DELETE /api/credentials/:id` — update/delete credential

## DB Schema

Tables: `workflows`, `nodes`, `edges`, `executions`, `log_lines`, `variables`, `credentials`, `packages`

See `references/openapi.md` for workspace structure details.
