import { useState, useMemo, useCallback } from "react";
import { X, Download, Search, Table2, FilterX } from "lucide-react";

// ─── Normalise any JSON value to a rows+columns table ────────────────────────

export function isTabular(value: unknown): boolean {
  if (Array.isArray(value) && value.length > 0) return true;
  if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length > 0) return true;
  return false;
}

function normalizeToTable(data: unknown): { columns: string[]; rows: unknown[][] } {
  if (Array.isArray(data)) {
    if (data.length === 0) return { columns: ["(vazio)"], rows: [] };

    if (typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
      const allKeys = new Set<string>();
      for (const row of data) {
        if (typeof row === "object" && row !== null) {
          for (const k of Object.keys(row as object)) allKeys.add(k);
        }
      }
      const cols = [...allKeys];
      const rows = data.map((r) =>
        cols.map((c) => (r as Record<string, unknown>)[c] ?? null)
      );
      return { columns: cols, rows };
    }

    if (Array.isArray(data[0])) {
      const maxLen = Math.max(...(data as unknown[][]).map((r) => r.length));
      const cols = Array.from({ length: maxLen }, (_, i) => String(i));
      const rows = (data as unknown[][]).map((r) => cols.map((_, i) => r[i] ?? null));
      return { columns: cols, rows };
    }

    return { columns: ["valor"], rows: data.map((v) => [v]) };
  }

  if (typeof data === "object" && data !== null) {
    return {
      columns: ["chave", "valor"],
      rows: Object.entries(data as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "object" ? JSON.stringify(v) : v,
      ]),
    };
  }

  return { columns: ["valor"], rows: [[data]] };
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function CellValue({ value, filter }: { value: unknown; filter: string }) {
  const raw =
    value === null || value === undefined
      ? "null"
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  const color =
    value === null || value === undefined
      ? "#6b7280"
      : typeof value === "number"
      ? "#a78bfa"
      : typeof value === "boolean"
      ? "#fb923c"
      : "hsl(var(--foreground))";

  if (!filter || !raw.toLowerCase().includes(filter.toLowerCase())) {
    return <span style={{ color }}>{raw}</span>;
  }

  const idx = raw.toLowerCase().indexOf(filter.toLowerCase());
  return (
    <span style={{ color }}>
      {raw.slice(0, idx)}
      <mark
        style={{
          background: "rgba(251,191,36,0.3)",
          color: "#fbbf24",
          borderRadius: 2,
        }}
      >
        {raw.slice(idx, idx + filter.length)}
      </mark>
      {raw.slice(idx + filter.length)}
    </span>
  );
}

// ─── Main DataTableModal ──────────────────────────────────────────────────────

export function DataTableModal({
  data,
  varName,
  onClose,
}: {
  data: unknown;
  varName: string;
  onClose: () => void;
}) {
  const { columns, rows } = useMemo(() => normalizeToTable(data), [data]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const hasActiveFilter = Object.values(filters).some((f) => f);

  const filteredRows = useMemo(() => {
    return rows.filter((row) =>
      columns.every((col, i) => {
        const f = (filters[col] ?? "").toLowerCase();
        if (!f) return true;
        const cell =
          row[i] === null || row[i] === undefined
            ? "null"
            : typeof row[i] === "object"
            ? JSON.stringify(row[i])
            : String(row[i]);
        return cell.toLowerCase().includes(f);
      })
    );
  }, [rows, columns, filters]);

  const handleFilterChange = useCallback((col: string, val: string) => {
    setFilters((prev) => ({ ...prev, [col]: val }));
  }, []);

  const downloadCsv = useCallback(() => {
    const escape = (v: unknown) =>
      `"${(v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/"/g, '""')}"`;
    const header = columns.map(escape).join(",");
    const body = filteredRows.map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${varName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [columns, filteredRows, varName]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(94vw, 1160px)",
          height: "min(90vh, 720px)",
          background: "hsl(var(--background))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 32px 100px rgba(0,0,0,0.6)",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "11px 16px",
            borderBottom: "1px solid hsl(var(--border))",
            background: "rgba(255,255,255,0.025)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "rgba(52,211,153,0.12)",
              border: "1px solid rgba(52,211,153,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Table2 size={14} color="#34d399" />
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--foreground))", display: "flex", alignItems: "center", gap: 6 }}>
              <code
                style={{
                  color: "#34d399",
                  background: "rgba(52,211,153,0.08)",
                  padding: "2px 8px",
                  borderRadius: 5,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                pipeline["{varName}"]
              </code>
            </div>
            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
              {filteredRows.length !== rows.length
                ? `${filteredRows.length} de ${rows.length} linhas • `
                : `${rows.length} linhas • `}
              {columns.length} colunas
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {hasActiveFilter && (
              <button
                onClick={() => setFilters({})}
                title="Limpar todos os filtros"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "rgba(248,113,113,0.08)",
                  border: "1px solid rgba(248,113,113,0.25)",
                  color: "#f87171",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                <FilterX size={11} /> Limpar filtros
              </button>
            )}
            <button
              onClick={downloadCsv}
              title="Exportar CSV"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 6,
                background: "rgba(52,211,153,0.08)",
                border: "1px solid rgba(52,211,153,0.25)",
                color: "#34d399",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              <Download size={11} /> CSV
            </button>
            <button
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: "1px solid hsl(var(--border))",
                background: "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Table ── */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {rows.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 8,
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <Table2 size={32} style={{ opacity: 0.3 }} />
              <span style={{ fontSize: 13 }}>Nenhum dado para exibir.</span>
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  background: "hsl(var(--background))",
                  zIndex: 10,
                }}
              >
                {/* Column headers */}
                <tr>
                  <th
                    style={{
                      width: 46,
                      padding: "8px 10px",
                      borderBottom: "1px solid hsl(var(--border))",
                      textAlign: "right",
                      color: "hsl(var(--muted-foreground))",
                      fontSize: 10,
                      fontWeight: 500,
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    #
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: "8px 12px",
                        borderBottom: "1px solid hsl(var(--border))",
                        borderLeft: "1px solid rgba(255,255,255,0.05)",
                        textAlign: "left",
                        fontWeight: 700,
                        color: "hsl(var(--foreground))",
                        fontSize: 11,
                        whiteSpace: "nowrap",
                        background: "rgba(255,255,255,0.02)",
                        fontFamily: "monospace",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>

                {/* Filter row */}
                <tr>
                  <td
                    style={{
                      padding: "5px 8px",
                      borderBottom: "2px solid rgba(52,211,153,0.25)",
                      background: "rgba(255,255,255,0.01)",
                    }}
                  />
                  {columns.map((col) => (
                    <td
                      key={col}
                      style={{
                        padding: "5px 6px",
                        borderBottom: "2px solid rgba(52,211,153,0.25)",
                        borderLeft: "1px solid rgba(255,255,255,0.05)",
                        background: "rgba(255,255,255,0.01)",
                      }}
                    >
                      <div style={{ position: "relative" }}>
                        <Search
                          size={10}
                          style={{
                            position: "absolute",
                            left: 7,
                            top: "50%",
                            transform: "translateY(-50%)",
                            color: "hsl(var(--muted-foreground))",
                            pointerEvents: "none",
                          }}
                        />
                        <input
                          type="text"
                          value={filters[col] ?? ""}
                          onChange={(e) => handleFilterChange(col, e.target.value)}
                          placeholder="filtrar..."
                          style={{
                            width: "100%",
                            padding: "3px 8px 3px 22px",
                            background: filters[col]
                              ? "rgba(52,211,153,0.06)"
                              : "rgba(255,255,255,0.03)",
                            border: `1px solid ${filters[col] ? "rgba(52,211,153,0.4)" : "hsl(var(--border))"}`,
                            borderRadius: 5,
                            fontSize: 10,
                            color: "hsl(var(--foreground))",
                            outline: "none",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      style={{
                        padding: "32px",
                        textAlign: "center",
                        color: "hsl(var(--muted-foreground))",
                        fontSize: 12,
                        fontStyle: "italic",
                      }}
                    >
                      Nenhuma linha corresponde aos filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, ri) => (
                    <tr
                      key={ri}
                      style={{
                        background:
                          ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)",
                      }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLTableRowElement).style.background =
                          "rgba(52,211,153,0.04)")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLTableRowElement).style.background =
                          ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)")
                      }
                    >
                      <td
                        style={{
                          padding: "5px 10px",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          textAlign: "right",
                          color: "hsl(var(--muted-foreground))",
                          fontSize: 10,
                          fontWeight: 500,
                          userSelect: "none",
                        }}
                      >
                        {ri + 1}
                      </td>
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          style={{
                            padding: "5px 12px",
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                            borderLeft: "1px solid rgba(255,255,255,0.04)",
                            maxWidth: 340,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontFamily: "monospace",
                            fontSize: 11,
                          }}
                          title={
                            cell === null || cell === undefined
                              ? "null"
                              : typeof cell === "object"
                              ? JSON.stringify(cell)
                              : String(cell)
                          }
                        >
                          <CellValue value={cell} filter={filters[columns[ci]] ?? ""} />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            padding: "7px 16px",
            borderTop: "1px solid hsl(var(--border))",
            background: "rgba(255,255,255,0.015)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 10,
            color: "hsl(var(--muted-foreground))",
            flexShrink: 0,
          }}
        >
          <span>
            {hasActiveFilter
              ? `${filteredRows.length} de ${rows.length} linhas (filtrado) • ${columns.length} colunas`
              : `${rows.length} linhas • ${columns.length} colunas`}
          </span>
          <span style={{ opacity: 0.5 }}>Esc ou clique fora para fechar</span>
        </div>
      </div>
    </div>
  );
}
