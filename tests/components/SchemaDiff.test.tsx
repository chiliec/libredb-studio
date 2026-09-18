import "../setup-dom";
import "../helpers/mock-sonner";
import "../helpers/mock-navigation";

import { mock } from "bun:test";
import React from "react";

// ── Mock data ────────────────────────────────────────────────────────────────

const mockDiffWithChanges = {
  tables: [
    {
      action: "added",
      tableName: "new_table",
      columns: [{ action: "added", columnName: "id", targetType: "integer", changes: ['Added column "id" (integer)'] }],
      indexes: [],
      foreignKeys: [],
    },
    {
      action: "removed",
      tableName: "old_table",
      columns: [{ action: "removed", columnName: "name", sourceType: "varchar", changes: ['Removed column "name"'] }],
      indexes: [],
      foreignKeys: [],
    },
    {
      action: "modified",
      tableName: "users",
      columns: [
        {
          action: "modified",
          columnName: "email",
          sourceType: "varchar(100)",
          targetType: "varchar(255)",
          changes: ["Type changed: varchar(100) -> varchar(255)"],
        },
      ],
      indexes: [
        { action: "added", indexName: "idx_email", changes: ["Added index idx_email"] },
        { action: "removed", indexName: "idx_old", changes: ["Removed index idx_old"] },
        { action: "modified", indexName: "idx_name", changes: ["Columns changed"] },
      ],
      foreignKeys: [
        { action: "added", columnName: "org_id", changes: ["Added FK on org_id"] },
        { action: "removed", columnName: "dept_id", changes: ["Removed FK on dept_id"] },
      ],
    },
  ],
  summary: { added: 1, removed: 1, modified: 1 },
  hasChanges: true,
};

const mockDiffNoChanges = {
  tables: [],
  summary: { added: 0, removed: 0, modified: 0 },
  hasChanges: false,
};

const mockDiffSchemas = mock(() => structuredClone(mockDiffWithChanges));
const mockGenerateMigrationSQL = mock(() => "CREATE TABLE new_table (\n  id integer\n);\nDROP TABLE old_table;");

mock.module("@/lib/schema-diff/diff-engine", () => ({
  diffSchemas: mockDiffSchemas,
}));

mock.module("@/lib/schema-diff/migration-generator", () => ({
  generateMigrationSQL: mockGenerateMigrationSQL,
}));

// ── Mock SnapshotTimeline ────────────────────────────────────────────────────

let capturedTimelineProps: { onCompare?: (s: string, t: string) => void; onDelete?: (id: string) => void } = {};

mock.module("@/components/SnapshotTimeline", () => ({
  SnapshotTimeline: (props: {
    snapshots: unknown[];
    onCompare?: (s: string, t: string) => void;
    onDelete?: (id: string) => void;
  }) => {
    capturedTimelineProps = { onCompare: props.onCompare, onDelete: props.onDelete };
    return React.createElement("div", { "data-testid": "snapshot-timeline" }, `${props.snapshots.length} snapshots`);
  },
}));

// ── Mock UI components ───────────────────────────────────────────────────────

mock.module("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className, ...rest }: Record<string, unknown>) =>
    React.createElement(
      "button",
      { onClick: onClick as () => void, disabled: disabled as boolean, className, ...rest },
      children as React.ReactNode,
    ),
}));

mock.module("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement("span", { "data-testid": "badge", className }, children),
}));

// ── Mock Select: capture onValueChange callbacks ─────────────────────────────

// We store onValueChange keyed by the Select's current value prop.
// Source starts with value="current", Target starts with value="".
const selectCallbacks = new Map<string, (v: string) => void>();

mock.module("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => {
    const key = value ?? "__empty__";
    if (onValueChange) selectCallbacks.set(key, onValueChange);
    return React.createElement("div", { "data-testid": `select-${key}` }, children);
  },
  SelectTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "select-trigger" }, children),
  SelectContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "select-content" }, children),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    React.createElement("div", { "data-testid": `select-item-${value}`, "data-value": value }, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", { "data-testid": "select-value" }, placeholder),
}));

// ── Mock storage ─────────────────────────────────────────────────────────────

const mockSnapshots = [
  {
    id: "snap-1",
    connectionId: "test-pg-1",
    connectionName: "TestDB",
    databaseType: "postgres",
    schema: [
      {
        name: "old_table",
        columns: [{ name: "name", type: "varchar", nullable: true, isPrimary: false }],
        indexes: [],
        foreignKeys: [],
      },
      {
        name: "users",
        columns: [{ name: "email", type: "varchar(100)", nullable: true, isPrimary: false }],
        indexes: [],
        foreignKeys: [],
      },
    ],
    createdAt: new Date("2026-01-10T10:00:00Z"),
    label: "Before migration",
  },
];

/**
 * The store, as a store. The panel reads back what it just wrote, because the real one
 * SWALLOWS a quota refusal - `saveSchemaSnapshot` returns nothing and `local-storage.ts`
 * catches the error - so a mock that accepts a write and then answers without it would be
 * testing the panel against a store that does not exist.
 */
const savedSnapshots: unknown[] = [];
const mockGetSchemaSnapshots = mock(() => [...mockSnapshots, ...savedSnapshots]);
const mockSaveSchemaSnapshot = mock((snapshot?: unknown) => {
  if (snapshot !== undefined) savedSnapshots.push(snapshot);
});
const mockDeleteSchemaSnapshot = mock(() => {});
const mockGetConnections = mock(() => [
  {
    id: "remote-1",
    name: "Remote PG",
    type: "postgres",
    host: "remote",
    port: 5432,
    database: "db",
    createdAt: new Date(),
  },
  {
    id: "remote-2",
    name: "Prod DB",
    type: "postgres",
    host: "prod",
    port: 5432,
    database: "db",
    environment: "production",
    createdAt: new Date(),
  },
]);

mock.module("@/lib/storage", () => ({
  storage: {
    getSchemaSnapshots: mockGetSchemaSnapshots,
    saveSchemaSnapshot: mockSaveSchemaSnapshot,
    deleteSchemaSnapshot: mockDeleteSchemaSnapshot,
    getConnections: mockGetConnections,
  },
}));

mock.module("@/hooks/use-all-connections", () => ({
  useAllConnections: () => ({
    connections: mockGetConnections(),
    loading: false,
  }),
}));

// ── Imports AFTER mocks ──────────────────────────────────────────────────────

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { SchemaDiff } from "@/components/SchemaDiff";
import { logger } from "@/lib/logger";
import { mockSchema } from "../fixtures/schemas";
import { mockMySQLConnection, mockPostgresConnection } from "../fixtures/connections";

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderDiff(overrides: Partial<Parameters<typeof SchemaDiff>[0]> = {}) {
  return render(<SchemaDiff schema={mockSchema} connection={mockPostgresConnection} {...overrides} />);
}

/** Trigger the source Select's onValueChange (source value starts as "current") */
function changeSource(value: string) {
  const fn = selectCallbacks.get("current");
  if (fn) act(() => fn(value));
}

/** Trigger the target Select's onValueChange (target value starts as "") */
function changeTarget(value: string) {
  const fn = selectCallbacks.get("__empty__") || selectCallbacks.get("");
  if (fn) act(() => fn(value));
}

/** Get the target callback for async tests (no act() wrapping) */
function getTargetCallback() {
  return selectCallbacks.get("__empty__") || selectCallbacks.get("");
}

/** Helper to set native input value and trigger React change handler */
function changeInput(input: HTMLInputElement, value: string) {
  // React controlled inputs need nativeInputValueSetter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    // fallback
    Object.defineProperty(input, "value", { value, writable: true, configurable: true });
  }
  fireEvent.input(input, { target: { value } });
  fireEvent.change(input, { target: { value } });
}

describe("SchemaDiff", () => {
  beforeEach(() => {
    mockDiffSchemas.mockClear();
    mockGenerateMigrationSQL.mockClear();
    mockGetSchemaSnapshots.mockClear();
    mockSaveSchemaSnapshot.mockClear();
    savedSnapshots.length = 0;
    mockDeleteSchemaSnapshot.mockClear();
    mockGetConnections.mockClear();
    selectCallbacks.clear();
    capturedTimelineProps = {};

    mockDiffSchemas.mockImplementation(() => structuredClone(mockDiffWithChanges));
    mockGenerateMigrationSQL.mockImplementation(
      () => "CREATE TABLE new_table (\n  id integer\n);\nDROP TABLE old_table;",
    );
    mockGetSchemaSnapshots.mockImplementation(() => [...mockSnapshots]);
    mockGetConnections.mockImplementation(() => [
      {
        id: "remote-1",
        name: "Remote PG",
        type: "postgres",
        host: "remote",
        port: 5432,
        database: "db",
        createdAt: new Date(),
      },
      {
        id: "remote-2",
        name: "Prod DB",
        type: "postgres",
        host: "prod",
        port: 5432,
        database: "db",
        environment: "production",
        createdAt: new Date(),
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Header
  // ═══════════════════════════════════════════════════════════════════════════

  describe("header", () => {
    test('renders "Schema Diff" title', () => {
      const { getByText } = renderDiff();
      expect(getByText("Schema Diff")).toBeTruthy();
    });

    test("renders Source and Target labels", () => {
      const { getByText } = renderDiff();
      expect(getByText("Source")).toBeTruthy();
      expect(getByText("Target")).toBeTruthy();
    });

    test('renders "vs" separator', () => {
      const { getByText } = renderDiff();
      expect(getByText("vs")).toBeTruthy();
    });

    test('renders "Current Schema" in select options', () => {
      const { getAllByText } = renderDiff();
      expect(getAllByText("Current Schema").length).toBeGreaterThanOrEqual(2);
    });

    test("renders snapshot items in select options", () => {
      const { getAllByText } = renderDiff();
      const items = getAllByText(/Before migration/);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Empty State
  // ═══════════════════════════════════════════════════════════════════════════

  describe("empty state", () => {
    test("shows instructions when no target selected", () => {
      const { getByText } = renderDiff();
      expect(getByText("Select source and target to compare schemas")).toBeTruthy();
      expect(getByText("Take a snapshot first, then compare with the current schema")).toBeTruthy();
    });

    test("shows SnapshotTimeline when snapshots exist", () => {
      const { container, getByText } = renderDiff();
      expect(container.querySelector('[data-testid="snapshot-timeline"]')).toBeTruthy();
      expect(getByText("1 snapshots")).toBeTruthy();
    });

    test("hides SnapshotTimeline when no snapshots", () => {
      mockGetSchemaSnapshots.mockImplementation(() => []);
      const { container } = renderDiff();
      expect(container.querySelector('[data-testid="snapshot-timeline"]')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Snapshot Controls
  // ═══════════════════════════════════════════════════════════════════════════

  describe("snapshot controls", () => {
    /**
     * The same answer as `answerSchemaReads`, except the INVENTORY half is held open until
     * the returned `release` is called.
     *
     * `provider-meta` still answers at once, so `readLiveSchema` gets all the way to the
     * read that matters and stops THERE. The gate lives in this closure and not in
     * `globalThis.fetch`, which is the point: the caller can swap `globalThis.fetch` for a
     * second connection while this first read is suspended, and release it afterwards.
     */
    function holdSchemaRead(objects: Array<{ name: string }> = [{ name: "users" }], ok = true) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const orig = globalThis.fetch;
      globalThis.fetch = mock((url: string) =>
        String(url).includes("provider-meta")
          ? Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  capabilities: {
                    queryLanguage: "sql",
                    objectKinds: [{ id: "table", role: "relation", label: "Table", labelPlural: "Tables" }],
                  },
                }),
            })
          : held.then(() => ({
              ok,
              json: () =>
                Promise.resolve(
                  ok
                    ? {
                        objects: objects.map((o) => ({ name: o.name, kind: "table", path: ["public", o.name] })),
                        details: objects.map((o) => ({
                          path: ["public", o.name],
                          columns: [],
                          indexes: [],
                          foreignKeys: [],
                        })),
                      }
                    : { error: "the connection you left is gone" },
                ),
            })),
      ) as unknown as typeof fetch;
      return { release, restore: () => void (globalThis.fetch = orig) };
    }

    /**
     * A snapshot now reads the database itself, so these tests have to answer that read.
     * They did not before, when it froze whatever the panel happened to be holding — which
     * is the defect: the sequence the Diff tab exists for (snapshot, change the database,
     * compare) answered "No differences found" with the panel left open, because the
     * snapshot and the other side were both the mount-time copy.
     */
    function answerSchemaReads(objects: Array<{ name: string }> = [{ name: "users" }]) {
      const orig = globalThis.fetch;
      const fetchMock = mock((url: string) =>
        Promise.resolve(
          url.includes("provider-meta")
            ? {
                ok: true,
                json: () =>
                  Promise.resolve({
                    capabilities: {
                      queryLanguage: "sql",
                      objectKinds: [{ id: "table", role: "relation", label: "Table", labelPlural: "Tables" }],
                    },
                  }),
              }
            : {
                ok: true,
                json: () =>
                  Promise.resolve({
                    objects: objects.map((o) => ({ name: o.name, kind: "table", path: ["public", o.name] })),
                    details: objects.map((o) => ({
                      path: ["public", o.name],
                      columns: [],
                      indexes: [],
                      foreignKeys: [],
                    })),
                  }),
              },
        ),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      return { fetchMock, restore: () => void (globalThis.fetch = orig) };
    }

    test("renders Snapshot button", () => {
      const { getByText } = renderDiff();
      expect(getByText("Snapshot")).toBeTruthy();
    });

    test("Snapshot button is disabled when no connection", () => {
      const { container } = renderDiff({ connection: null });
      const snapshotBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Snapshot"),
      );
      expect(snapshotBtn?.disabled).toBe(true);
    });

    test("clicking Snapshot shows label input", () => {
      const { getByText, getByPlaceholderText } = renderDiff();
      fireEvent.click(getByText("Snapshot"));
      expect(getByPlaceholderText("Label (optional)...")).toBeTruthy();
      expect(getByText("Save")).toBeTruthy();
      expect(getByText("Cancel")).toBeTruthy();
    });

    test("Cancel button hides label input", () => {
      const { getByText, queryByPlaceholderText } = renderDiff();
      fireEvent.click(getByText("Snapshot"));
      expect(queryByPlaceholderText("Label (optional)...")).toBeTruthy();
      fireEvent.click(getByText("Cancel"));
      expect(queryByPlaceholderText("Label (optional)...")).toBeNull();
    });

    test("Save button calls storage.saveSchemaSnapshot", async () => {
      const { restore } = answerSchemaReads();
      const { getByText, getByPlaceholderText, queryByPlaceholderText } = renderDiff();
      fireEvent.click(getByText("Snapshot"));

      const input = getByPlaceholderText("Label (optional)...") as HTMLInputElement;
      changeInput(input, "My label");
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      restore();

      expect(mockSaveSchemaSnapshot).toHaveBeenCalledTimes(1);
      const saved = (mockSaveSchemaSnapshot.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
      expect(saved.connectionId).toBe(mockPostgresConnection.id);
      expect(saved.connectionName).toBe(mockPostgresConnection.name);
      expect(saved.databaseType).toBe(mockPostgresConnection.type);

      // Label input should be hidden after save
      expect(queryByPlaceholderText("Label (optional)...")).toBeNull();
    });

    test("Save with empty label sets label to undefined", async () => {
      const { restore } = answerSchemaReads();
      const { getByText } = renderDiff();
      fireEvent.click(getByText("Snapshot"));
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      restore();

      expect(mockSaveSchemaSnapshot).toHaveBeenCalledTimes(1);
      expect(
        ((mockSaveSchemaSnapshot.mock.calls as unknown[][])[0][0] as Record<string, unknown>).label,
      ).toBeUndefined();
    });

    test("Enter key in label input triggers snapshot save", async () => {
      const { restore } = answerSchemaReads();
      const { getByText, getByPlaceholderText } = renderDiff();
      fireEvent.click(getByText("Snapshot"));

      const input = getByPlaceholderText("Label (optional)...") as HTMLInputElement;
      changeInput(input, "Enter label");
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
      restore();

      expect(mockSaveSchemaSnapshot).toHaveBeenCalledTimes(1);
    });

    test("records what the database holds NOW, not what the panel read when it opened", async () => {
      // The whole point of the tab: snapshot, change the database, compare. With the panel
      // left open that answered "No differences found", because the snapshot froze the
      // mount-time copy and so did the other side. The panel is mounted here, the database
      // gains a table, and the snapshot has to carry it.
      const first = answerSchemaReads([{ name: "users" }]);
      const { getByText } = renderDiff();
      await act(async () => {});
      first.restore();

      const second = answerSchemaReads([{ name: "users" }, { name: "added_after_open" }]);
      fireEvent.click(getByText("Snapshot"));
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      second.restore();

      expect(mockSaveSchemaSnapshot).toHaveBeenCalledTimes(1);
      const saved = (mockSaveSchemaSnapshot.mock.calls as unknown[][])[0][0] as { schema: Array<{ name: string }> };
      expect(saved.schema.map((o) => o.name).sort()).toEqual(["added_after_open", "users"]);
    });

    test("saves nothing when that read fails, and says why", async () => {
      const first = answerSchemaReads([{ name: "users" }]);
      const { getByText, findByText } = renderDiff();
      await act(async () => {});
      first.restore();

      const orig = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "the database refused the read" }) }),
      ) as unknown as typeof fetch;
      fireEvent.click(getByText("Snapshot"));
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      globalThis.fetch = orig;

      // A stale snapshot is the defect again with a longer fuse, so nothing is written.
      expect(mockSaveSchemaSnapshot).not.toHaveBeenCalled();
      expect(await findByText(/No snapshot was saved: the database refused the read/)).toBeTruthy();
    });

    test("Enter twice saves once, not twice", async () => {
      const { restore } = answerSchemaReads();
      const { getByText, getByPlaceholderText } = renderDiff();
      await act(async () => {});
      fireEvent.click(getByText("Snapshot"));
      const input = getByPlaceholderText("Label (optional)...") as HTMLInputElement;

      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
        fireEvent.keyDown(input, { key: "Enter" });
      });
      restore();

      expect(mockSaveSchemaSnapshot).toHaveBeenCalledTimes(1);
    });

    test("a storage refusal unlocks the button and says so", async () => {
      // Snapshots live in localStorage and a snapshot is a whole schema, so a quota refusal
      // is ordinary. Before the `finally`, this left the button reading "Reading..." for the
      // life of the panel with nothing on screen explaining it.
      const { restore } = answerSchemaReads();
      mockSaveSchemaSnapshot.mockImplementationOnce(() => {
        throw new Error("the browser refused to store it");
      });
      const { getByText, findByText, queryByText } = renderDiff();
      await act(async () => {});
      fireEvent.click(getByText("Snapshot"));
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      restore();

      expect(await findByText(/No snapshot was saved: the browser refused to store it/)).toBeTruthy();
      expect(queryByText("Reading...")).toBeNull();
      expect(getByText("Save")).toBeTruthy();
    });

    test("says a snapshot failed even while the panel's own read is failing too", async () => {
      // Two different facts: what Current Schema means, and whether the thing you just
      // pressed wrote anything. Only the first used to reach the screen.
      const orig = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "the database is unreachable" }) }),
      ) as unknown as typeof fetch;

      const { getByText, findByText } = renderDiff();
      await act(async () => {});
      fireEvent.click(getByText("Snapshot"));
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      globalThis.fetch = orig;

      expect(mockSaveSchemaSnapshot).not.toHaveBeenCalled();
      expect(await findByText(/Current Schema is the explorer's last copy/)).toBeTruthy();
      expect(await findByText(/No snapshot was saved: the database is unreachable/)).toBeTruthy();
    });

    test("the same read becomes Current Schema, not just the snapshot", async () => {
      // The other half of this change: the read a snapshot makes is also stored as the
      // panel's own copy, so the snapshot and the side it will be compared against are the
      // same instant. Asserted through the error banner, which is what `liveRead` drives:
      // after a successful snapshot read the panel is no longer falling back to the
      // explorer's copy, even though the read it did on mount had failed.
      const orig = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "mount read failed" }) }),
      ) as unknown as typeof fetch;
      const { getByText, findByText, queryByText } = renderDiff();
      expect(await findByText(/Current Schema is the explorer's last copy/)).toBeTruthy();

      const { restore } = answerSchemaReads([{ name: "users" }, { name: "added_after_open" }]);
      fireEvent.click(getByText("Snapshot"));
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      restore();
      globalThis.fetch = orig;

      expect(mockSaveSchemaSnapshot).toHaveBeenCalledTimes(1);
      // The banner is gone, which it can only be because the snapshot's read replaced the
      // failed one as Current Schema.
      expect(queryByText(/Current Schema is the explorer's last copy/)).toBeNull();
    });

    test("the Save button is disabled while its read is in flight", async () => {
      const { restore } = answerSchemaReads();
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const orig = globalThis.fetch;
      const passthrough = globalThis.fetch;
      globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
        if (String(url).includes("inventory")) await held;
        return passthrough(url as never, init as never);
      }) as unknown as typeof fetch;

      const { getByText, container } = renderDiff();
      fireEvent.click(getByText("Snapshot"));
      let pending: Promise<unknown> | undefined;
      await act(async () => {
        fireEvent.click(getByText("Save"));
        pending = Promise.resolve();
        await pending;
      });

      const saving = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Reading..."),
      );
      expect(saving?.disabled).toBe(true);
      // The label and Cancel go with it: a label typed now would not reach the snapshot the
      // read is already building, and Cancel would close the panel over a save that is still
      // going to happen.
      expect((container.querySelector("input[placeholder='Label (optional)...']") as HTMLInputElement).disabled).toBe(
        true,
      );
      expect(
        Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Cancel"))?.disabled,
      ).toBe(true);

      release?.();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      globalThis.fetch = orig;
      restore();
    });

    test("a snapshot read that lands after the connection changed saves nothing and is not kept", async () => {
      // A read is not instant - it opens a connection and asks a catalog - and the panel
      // stays usable while it runs, so the user can switch connections inside that window.
      // The mount effect has a `cancelled` flag for exactly this; the snapshot's own read
      // needs the same check, or its late answer is written as the CURRENT connection's
      // Current Schema, the identity test then rejects it, and the panel falls silently back
      // to the explorer's copy with no banner - #884 again, on a connection the user is
      // looking at right now.
      const origFetch = globalThis.fetch;
      try {
        const a = answerSchemaReads([{ name: "a_table" }]);
        let view!: ReturnType<typeof render>;
        await act(async () => {
          view = renderDiff();
        });
        a.restore();

        // Save is pressed on A, and THAT read is held open.
        const heldA = holdSchemaRead([{ name: "a_table" }]);
        fireEvent.click(view.getByText("Snapshot"));
        await act(async () => {
          fireEvent.click(view.getByText("Save"));
        });

        // While it is still in flight the user switches to B, whose own read lands.
        const b = answerSchemaReads([{ name: "b_table" }]);
        await act(async () => {
          view.rerender(<SchemaDiff schema={mockSchema} connection={mockMySQLConnection} />);
        });
        b.restore();

        mockSaveSchemaSnapshot.mockClear();
        await act(async () => {
          heldA.release();
          await new Promise((r) => setTimeout(r, 0));
        });
        heldA.restore();

        // Nothing is written for a connection the user has left.
        expect(mockSaveSchemaSnapshot).not.toHaveBeenCalled();

        // And B's own read is still what Current Schema means.
        mockDiffSchemas.mockClear();
        changeSource("snap-1");
        changeTarget("current");
        const current = (mockDiffSchemas.mock.calls as unknown[][]).at(-1)?.[1] as Array<{ name: string }>;
        expect(current.map((o) => o.name)).toEqual(["b_table"]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test("a snapshot read that FAILS after the connection changed leaves the new one alone", async () => {
      // The same window, the other outcome. Writing the old connection's failure onto the
      // new one would put a banner about a database the user is no longer looking at over a
      // panel that is working.
      const origFetch = globalThis.fetch;
      try {
        const a = answerSchemaReads([{ name: "a_table" }]);
        let view!: ReturnType<typeof render>;
        await act(async () => {
          view = renderDiff();
        });
        a.restore();

        const heldA = holdSchemaRead([], false);
        fireEvent.click(view.getByText("Snapshot"));
        await act(async () => {
          fireEvent.click(view.getByText("Save"));
        });

        const b = answerSchemaReads([{ name: "b_table" }]);
        await act(async () => {
          view.rerender(<SchemaDiff schema={mockSchema} connection={mockMySQLConnection} />);
        });
        b.restore();

        await act(async () => {
          heldA.release();
          await new Promise((r) => setTimeout(r, 0));
        });
        heldA.restore();

        expect(view.queryByText(/the connection you left is gone/)).toBeNull();
        mockDiffSchemas.mockClear();
        changeSource("snap-1");
        changeTarget("current");
        const current = (mockDiffSchemas.mock.calls as unknown[][]).at(-1)?.[1] as Array<{ name: string }>;
        expect(current.map((o) => o.name)).toEqual(["b_table"]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test("snapshot, change the database, compare - the sequence the tab exists for", async () => {
      // The whole claim, end to end, with the panel never closed. The earlier fix made the
      // SNAPSHOT read fresh and stopped there, so the other side of the comparison was still
      // frozen at the moment the snapshot was taken and the answer was "No differences
      // found" all the same. Choosing a target is what reads again.
      const a = answerSchemaReads([{ name: "users" }]);
      const { getByText } = renderDiff();
      await act(async () => {});
      a.restore();

      // A snapshot of the schema as it stands: read fresh, so it carries what is there now.
      const b = answerSchemaReads([{ name: "users" }]);
      fireEvent.click(getByText("Snapshot"));
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      b.restore();
      const saved = (mockSaveSchemaSnapshot.mock.calls as unknown[][])[0][0] as {
        schema: Array<{ name: string }>;
      };
      expect(saved.schema.map((o) => o.name)).toEqual(["users"]);

      // The database gains a table, and a target is chosen WITHOUT leaving the tab.
      const c = answerSchemaReads([{ name: "users" }, { name: "added_between" }]);
      mockDiffSchemas.mockClear();
      changeTarget("snap-1");
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      c.restore();

      // Current Schema was read again, so the comparison sees the new table. Without the
      // second read this side would still be the schema of the moment the snapshot was taken.
      const [source] = (mockDiffSchemas.mock.calls as unknown[][]).at(-1) as [Array<{ name: string }>];
      expect(source.map((o) => o.name).sort()).toEqual(["added_between", "users"]);
    });

    test("a snapshot overtaken on the SAME connection says so instead of vanishing", async () => {
      // Choosing a target reads the connection too, so a snapshot in flight can be overtaken
      // without the connection changing at all. Returning quietly there saved nothing and
      // said nothing: the button went back to "Save" and the user believed it had saved.
      const origFetch = globalThis.fetch;
      try {
        const a = answerSchemaReads([{ name: "users" }]);
        let view!: ReturnType<typeof render>;
        await act(async () => {
          view = renderDiff();
        });
        a.restore();

        const held = holdSchemaRead([{ name: "users" }]);
        fireEvent.click(view.getByText("Snapshot"));
        await act(async () => {
          fireEvent.click(view.getByText("Save"));
        });

        // A target is chosen while that read is still out, which begins a newer one.
        const b = answerSchemaReads([{ name: "users" }]);
        await act(async () => {
          changeTarget("snap-1");
        });
        b.restore();

        mockSaveSchemaSnapshot.mockClear();
        await act(async () => {
          held.release();
          await new Promise((r) => setTimeout(r, 0));
        });
        held.restore();

        expect(mockSaveSchemaSnapshot).not.toHaveBeenCalled();
        expect(await view.findByText(/read again before this finished/)).toBeTruthy();
        expect(view.queryByText("Reading...")).toBeNull();
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test("a later successful read clears the banner a failed snapshot left", async () => {
      const origFetch = globalThis.fetch;
      try {
        const a = answerSchemaReads([{ name: "users" }]);
        let view!: ReturnType<typeof render>;
        await act(async () => {
          view = renderDiff();
        });
        a.restore();

        globalThis.fetch = mock(() =>
          Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "the database blinked" }) }),
        ) as unknown as typeof fetch;
        fireEvent.click(view.getByText("Snapshot"));
        await act(async () => {
          fireEvent.click(view.getByText("Save"));
        });
        expect(await view.findByText(/No snapshot was saved: the database blinked/)).toBeTruthy();

        // The panel reads this same database again - choosing a target does - and it works.
        // The old banner is about a moment the user has already walked away from.
        const c = answerSchemaReads([{ name: "users" }]);
        await act(async () => {
          changeTarget("snap-1");
          await new Promise((r) => setTimeout(r, 0));
        });
        c.restore();

        expect(view.queryByText(/No snapshot was saved/)).toBeNull();
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test("comparing two snapshots reads no database at all", async () => {
      const a = answerSchemaReads([{ name: "users" }]);
      const { container } = renderDiff();
      await act(async () => {});
      a.restore();

      const orig = globalThis.fetch;
      const counted = mock(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ objects: [], details: [] }) }),
      );
      globalThis.fetch = counted as unknown as typeof fetch;
      await act(async () => {
        changeSource("snap-1");
        changeTarget("snap-1");
        await new Promise((r) => setTimeout(r, 0));
      });
      globalThis.fetch = orig;

      // Two files against each other. A round trip here changes nothing either side shows.
      expect(counted).not.toHaveBeenCalled();
      expect(container).toBeTruthy();
    });

    test("takeSnapshot does nothing when connection is null", () => {
      // Snapshot button is disabled for null connection, so storage should not be called
      renderDiff({ connection: null });
      expect(mockSaveSchemaSnapshot).not.toHaveBeenCalled();
    });

    test("snapshot save refreshes snapshot list", async () => {
      const { restore } = answerSchemaReads();
      const { getByText } = renderDiff();
      const callsBefore = mockGetSchemaSnapshots.mock.calls.length;
      fireEvent.click(getByText("Snapshot"));
      await act(async () => {
        fireEvent.click(getByText("Save"));
      });
      restore();
      expect(mockGetSchemaSnapshots.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Source/Target Selection
  // ═══════════════════════════════════════════════════════════════════════════

  describe("source/target selection", () => {
    test("selecting a target triggers diff display", () => {
      const { queryByText } = renderDiff();
      changeTarget("snap-1");
      // diff has changes → summary should appear
      expect(queryByText(/1 added, 1 removed, 1 modified/)).toBeTruthy();
    });

    test("selecting same source and target shows same-schema message", () => {
      const { getByText } = renderDiff();
      changeTarget("current");
      // source=current, target=current → same → null diff
      expect(getByText("Cannot compare same schema with itself")).toBeTruthy();
    });

    test("changing source updates diff", () => {
      renderDiff();
      changeSource("snap-1");
      changeTarget("current");
      expect(mockDiffSchemas).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Diff View (hasChanges = true)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("diff view with changes", () => {
    function renderWithDiff() {
      const result = renderDiff();
      changeTarget("snap-1");
      return result;
    }

    test("shows summary counts", () => {
      const { getByText } = renderWithDiff();
      expect(getByText(/1 added, 1 removed, 1 modified/)).toBeTruthy();
    });

    test("renders all table names in sidebar", () => {
      const { getByText } = renderWithDiff();
      expect(getByText("new_table")).toBeTruthy();
      expect(getByText("old_table")).toBeTruthy();
      expect(getByText("users")).toBeTruthy();
    });

    test("renders action badges for tables", () => {
      const { getByText } = renderWithDiff();
      expect(getByText("Added")).toBeTruthy();
      expect(getByText("Removed")).toBeTruthy();
      expect(getByText("Modified")).toBeTruthy();
    });

    test('shows "Select a table" prompt when no table is selected', () => {
      const { getByText } = renderWithDiff();
      expect(getByText("Select a table to view diff details")).toBeTruthy();
    });

    test("clicking a table shows its detail", () => {
      const { getByText } = renderWithDiff();
      fireEvent.click(getByText("new_table"));
      // TableDiffDetail renders: table heading with action badge
      const badges = document.querySelectorAll('[data-testid="badge"]');
      const addedBadge = Array.from(badges).find((b) => b.textContent === "added");
      expect(addedBadge).toBeTruthy();
    });

    test("clicking a different table switches detail", () => {
      const { getByText } = renderWithDiff();
      fireEvent.click(getByText("new_table"));
      // new_table detail should show column "id"
      expect(getByText("id")).toBeTruthy();

      fireEvent.click(getByText("old_table"));
      // old_table detail should show column "name"
      expect(getByText("name")).toBeTruthy();
    });

    test("selected table has ChevronDown, others have ChevronRight", () => {
      const { container, getByText } = renderWithDiff();
      fireEvent.click(getByText("new_table"));

      const tableButtons = Array.from(container.querySelectorAll("button"));
      const newTableBtn = tableButtons.find((b) => b.textContent?.includes("new_table"));
      const oldTableBtn = tableButtons.find((b) => b.textContent?.includes("old_table"));

      expect(newTableBtn?.querySelector(".lucide-chevron-down")).toBeTruthy();
      expect(oldTableBtn?.querySelector(".lucide-chevron-right")).toBeTruthy();
    });

    test("selected table has highlighted background", () => {
      const { container, getByText } = renderWithDiff();
      fireEvent.click(getByText("users"));

      const usersBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("users"));
      expect(usersBtn?.className).toContain("bg-fill-strong");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // No Changes State
  // ═══════════════════════════════════════════════════════════════════════════

  describe("no changes state", () => {
    test('shows "No differences found" message', () => {
      mockDiffSchemas.mockImplementation(() => structuredClone(mockDiffNoChanges));
      const { getByText } = renderDiff();
      changeTarget("snap-1");
      expect(getByText("No differences found between source and target")).toBeTruthy();
    });

    test("SQL Migration button does not appear when no changes", () => {
      mockDiffSchemas.mockImplementation(() => structuredClone(mockDiffNoChanges));
      const { queryByText } = renderDiff();
      changeTarget("snap-1");
      expect(queryByText("SQL Migration")).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Migration SQL View
  // ═══════════════════════════════════════════════════════════════════════════

  describe("migration SQL", () => {
    function renderWithDiff() {
      const result = renderDiff();
      changeTarget("snap-1");
      return result;
    }

    test("SQL Migration button appears when diff has changes", () => {
      const { getByText } = renderWithDiff();
      expect(getByText("SQL Migration")).toBeTruthy();
    });

    test("clicking SQL Migration shows SQL and changes button text", () => {
      const { getByText, container } = renderWithDiff();
      fireEvent.click(getByText("SQL Migration"));

      expect(container.textContent).toContain("CREATE TABLE new_table");
      expect(container.textContent).toContain("DROP TABLE old_table");
      expect(getByText("Diff View")).toBeTruthy();
    });

    test("toggling back to diff view shows table list again", () => {
      const { getByText } = renderWithDiff();
      fireEvent.click(getByText("SQL Migration"));
      expect(getByText("Diff View")).toBeTruthy();

      fireEvent.click(getByText("Diff View"));
      expect(getByText("SQL Migration")).toBeTruthy();
      expect(getByText("new_table")).toBeTruthy();
    });

    test("migration SQL is rendered in a pre tag", () => {
      const { getByText, container } = renderWithDiff();
      fireEvent.click(getByText("SQL Migration"));
      const pre = container.querySelector("pre");
      expect(pre).toBeTruthy();
      expect(pre!.textContent).toContain("CREATE TABLE");
    });

    test("generateMigrationSQL receives correct dialect", () => {
      renderWithDiff();
      if (mockGenerateMigrationSQL.mock.calls.length > 0) {
        const dialect = (mockGenerateMigrationSQL.mock.calls as unknown[][])[0][1];
        expect(dialect).toBe("postgres");
      }
    });

    test("defaults to postgres dialect when connection is null", () => {
      renderDiff({ connection: null });
      changeTarget("snap-1");
      if (mockGenerateMigrationSQL.mock.calls.length > 0) {
        const dialect = (mockGenerateMigrationSQL.mock.calls as unknown[][])[0][1];
        expect(dialect).toBe("postgres");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TableDiffDetail Sub-Component
  // ═══════════════════════════════════════════════════════════════════════════

  describe("TableDiffDetail", () => {
    function renderAndSelectTable(tableName: string) {
      const result = renderDiff();
      changeTarget("snap-1");
      fireEvent.click(result.getByText(tableName));
      return result;
    }

    // ── Header ──

    test("shows table name and action badge", () => {
      const { container } = renderAndSelectTable("new_table");
      const badges = container.querySelectorAll('[data-testid="badge"]');
      const addedBadge = Array.from(badges).find((b) => b.textContent === "added");
      expect(addedBadge).toBeTruthy();
    });

    test("removed table shows removed badge", () => {
      const { container } = renderAndSelectTable("old_table");
      const badges = container.querySelectorAll('[data-testid="badge"]');
      const removedBadge = Array.from(badges).find((b) => b.textContent === "removed");
      expect(removedBadge).toBeTruthy();
    });

    test("modified table shows modified badge", () => {
      const { container } = renderAndSelectTable("users");
      const badges = container.querySelectorAll('[data-testid="badge"]');
      const modifiedBadge = Array.from(badges).find((b) => b.textContent === "modified");
      expect(modifiedBadge).toBeTruthy();
    });

    // ── Columns ──

    test('renders "Columns" heading when columns exist', () => {
      const { getByText } = renderAndSelectTable("users");
      expect(getByText("Columns")).toBeTruthy();
    });

    test("renders added column with target type", () => {
      const { getByText } = renderAndSelectTable("new_table");
      expect(getByText("id")).toBeTruthy();
      expect(getByText("integer")).toBeTruthy();
    });

    test("renders removed column with source type", () => {
      const { getByText } = renderAndSelectTable("old_table");
      expect(getByText("name")).toBeTruthy();
      expect(getByText("varchar")).toBeTruthy();
    });

    test("renders modified column with change details", () => {
      const { getByText } = renderAndSelectTable("users");
      expect(getByText("email")).toBeTruthy();
      expect(getByText("Type changed: varchar(100) -> varchar(255)")).toBeTruthy();
    });

    test("added column row has the green hue tint background", () => {
      const { getByText } = renderAndSelectTable("new_table");
      const colRow = getByText("id").closest('div[class*="rounded"]');
      expect(colRow?.className).toContain("bg-hue-green-tint/5");
    });

    test("removed column row has the red hue tint background", () => {
      const { getByText } = renderAndSelectTable("old_table");
      const colRow = getByText("name").closest('div[class*="rounded"]');
      expect(colRow?.className).toContain("bg-hue-red-tint/5");
    });

    test("modified column row has the yellow hue tint background", () => {
      const { getByText } = renderAndSelectTable("users");
      const colRow = getByText("email").closest('div[class*="rounded"]');
      expect(colRow?.className).toContain("bg-hue-yellow-tint/5");
    });

    // ── Indexes ──

    test('renders "Indexes" heading when indexes exist', () => {
      const { getByText } = renderAndSelectTable("users");
      expect(getByText("Indexes")).toBeTruthy();
    });

    test("renders index names and changes", () => {
      const { getByText } = renderAndSelectTable("users");
      expect(getByText("idx_email")).toBeTruthy();
      expect(getByText("idx_old")).toBeTruthy();
      expect(getByText("idx_name")).toBeTruthy();
      expect(getByText("Added index idx_email")).toBeTruthy();
      expect(getByText("Removed index idx_old")).toBeTruthy();
      expect(getByText("Columns changed")).toBeTruthy();
    });

    test("index rows have correct backgrounds", () => {
      const { getByText } = renderAndSelectTable("users");
      const addedIdx = getByText("idx_email").closest('div[class*="rounded"]');
      expect(addedIdx?.className).toContain("bg-hue-green-tint/5");
      const removedIdx = getByText("idx_old").closest('div[class*="rounded"]');
      expect(removedIdx?.className).toContain("bg-hue-red-tint/5");
      const modifiedIdx = getByText("idx_name").closest('div[class*="rounded"]');
      expect(modifiedIdx?.className).toContain("bg-hue-yellow-tint/5");
    });

    test('does not render "Indexes" heading when no indexes', () => {
      const { queryByText } = renderAndSelectTable("new_table");
      expect(queryByText("Indexes")).toBeNull();
    });

    // ── Foreign Keys ──

    test('renders "Foreign Keys" heading when FKs exist', () => {
      const { getByText } = renderAndSelectTable("users");
      expect(getByText("Foreign Keys")).toBeTruthy();
    });

    test("renders FK column names and changes", () => {
      const { getByText } = renderAndSelectTable("users");
      expect(getByText("org_id")).toBeTruthy();
      expect(getByText("dept_id")).toBeTruthy();
      expect(getByText("Added FK on org_id")).toBeTruthy();
      expect(getByText("Removed FK on dept_id")).toBeTruthy();
    });

    test("FK rows have correct backgrounds", () => {
      const { getByText } = renderAndSelectTable("users");
      const addedFK = getByText("org_id").closest('div[class*="rounded"]');
      expect(addedFK?.className).toContain("bg-hue-green-tint/5");
      const removedFK = getByText("dept_id").closest('div[class*="rounded"]');
      expect(removedFK?.className).toContain("bg-hue-red-tint/5");
    });

    test('does not render "Foreign Keys" heading when no FKs', () => {
      const { queryByText } = renderAndSelectTable("new_table");
      expect(queryByText("Foreign Keys")).toBeNull();
    });

    // A foreign key REPOINTED at another table is two entries under one column name:
    // the diff engine keys an FK by `columnName→table.column` (`diff-engine.ts`), so
    // it reports the old one removed and the new one added. Keying the rows by the
    // column name alone gave React two children with the same key — one row, and the
    // half of the change the user needed to see missing.
    test("renders both halves of a foreign key that was repointed", () => {
      mockDiffSchemas.mockImplementation(() =>
        structuredClone({
          tables: [
            {
              action: "modified",
              tableName: "users",
              columns: [],
              indexes: [],
              foreignKeys: [
                { action: "removed", columnName: "org_id", changes: ["Removed FK: org_id -> orgs(id)"] },
                { action: "added", columnName: "org_id", changes: ["Added FK: org_id -> tenants(id)"] },
              ],
            },
          ],
          summary: { added: 0, removed: 0, modified: 1 },
          hasChanges: true,
        }),
      );
      const complaints: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        complaints.push(args.map(String).join(" "));
      };
      try {
        const { getByText, getAllByText } = renderDiff();
        changeTarget("snap-1");
        fireEvent.click(getByText("users"));

        expect(getAllByText("org_id")).toHaveLength(2);
        expect(getByText("Removed FK: org_id -> orgs(id)")).toBeTruthy();
        expect(getByText("Added FK: org_id -> tenants(id)")).toBeTruthy();
      } finally {
        console.error = originalError;
      }
      expect(complaints.filter((line) => line.includes("same key"))).toEqual([]);
    });

    test("renders no action icon for unknown column action", () => {
      mockDiffSchemas.mockImplementation(() =>
        structuredClone({
          tables: [
            {
              action: "modified",
              tableName: "users",
              columns: [
                {
                  action: "unchanged",
                  columnName: "created_at",
                  sourceType: "timestamp",
                  targetType: "timestamp",
                  changes: [] as string[],
                },
              ],
              indexes: [],
              foreignKeys: [],
            },
          ],
          summary: { added: 0, removed: 0, modified: 1 },
          hasChanges: true,
        }),
      );
      const { getByText } = renderDiff();
      changeTarget("snap-1");
      fireEvent.click(getByText("users"));

      const colRow = getByText("created_at").closest('div[class*="rounded"]');
      expect(colRow).toBeTruthy();
      expect(colRow!.querySelector("svg")).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SnapshotTimeline Integration
  // ═══════════════════════════════════════════════════════════════════════════

  describe("SnapshotTimeline integration", () => {
    test("onCompare callback sets source and target", () => {
      renderDiff();
      expect(capturedTimelineProps.onCompare).toBeDefined();

      act(() => {
        capturedTimelineProps.onCompare!("snap-1", "current");
      });

      // Diff should be triggered
      expect(mockDiffSchemas).toHaveBeenCalled();
    });

    test("onDelete callback removes snapshot", () => {
      renderDiff();
      expect(capturedTimelineProps.onDelete).toBeDefined();

      act(() => {
        capturedTimelineProps.onDelete!("snap-1");
      });

      expect(mockDeleteSchemaSnapshot).toHaveBeenCalledWith("snap-1");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cross-Connection Comparison
  // ═══════════════════════════════════════════════════════════════════════════

  describe("cross-connection comparison", () => {
    test('renders "Fetch from connection" section in target selector', () => {
      const { getByText } = renderDiff();
      expect(getByText("Fetch from connection")).toBeTruthy();
    });

    test("renders remote connections", () => {
      const { getByText } = renderDiff();
      expect(getByText("Remote PG")).toBeTruthy();
      expect(getByText("Prod DB")).toBeTruthy();
    });

    test('does not show "Fetch from connection" when no other connections', () => {
      mockGetConnections.mockImplementation(() => []);
      const { queryByText } = renderDiff();
      expect(queryByText("Fetch from connection")).toBeNull();
    });

    test("production connection shows warning icon", () => {
      const { getByText } = renderDiff();
      // Find Prod DB text and check its parent container for the AlertTriangle icon
      const prodText = getByText("Prod DB");
      const wrapper = prodText.closest('[data-testid^="select-item-"]') || prodText.parentElement;
      expect(wrapper).toBeTruthy();
      // Lucide renders class="lucide lucide-triangle-alert ..."
      const alertIcon = wrapper!.querySelector('svg[class*="alert-triangle"], svg[class*="triangle-alert"]');
      expect(alertIcon).toBeTruthy();
    });

    test("selecting a remote connection reads the object inventory, kinds first", async () => {
      // Two requests, not one (#789): `/api/db/provider-meta` decides which kinds a diff can
      // compare, then the inventory is asked for those kinds with their columns. The route it
      // replaces, `/api/db/schema-snapshot`, is deleted.
      const origFetch = globalThis.fetch;
      const mockFetch = mock((url: string) =>
        Promise.resolve(
          url.includes("provider-meta")
            ? {
                ok: true,
                json: () =>
                  Promise.resolve({
                    capabilities: {
                      queryLanguage: "sql",
                      objectKinds: [{ id: "table", role: "relation", label: "Table", labelPlural: "Tables" }],
                    },
                  }),
              }
            : {
                ok: true,
                json: () =>
                  Promise.resolve({
                    objects: [{ name: "users", kind: "table", path: ["public", "users"] }],
                    details: [{ path: ["public", "users"], columns: [], indexes: [], foreignKeys: [] }],
                  }),
              },
        ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        renderDiff();
        const fn = getTargetCallback();
        expect(fn).toBeTruthy();

        await act(async () => {
          fn!("conn:remote-1");
        });

        // Six requests, in three pairs: the panel reads the CURRENT schema when it opens
        // (#884), it reads it AGAIN when a target is chosen, because that is the moment
        // someone asks to be told the difference, and the remote selection is its own read.
        // Picked out below by the connection they name rather than by position, because the
        // reads interleave.
        expect(mockFetch).toHaveBeenCalledTimes(6);
        const calls = mockFetch.mock.calls as unknown[][];
        const forRemote = calls.filter(([, init]) =>
          String((init as RequestInit | undefined)?.body ?? "").includes('"id":"remote-1"'),
        );
        expect(forRemote).toHaveLength(2);
        expect(forRemote[0][0]).toBe("/api/db/provider-meta");
        const [url, options] = forRemote[1] as [string, RequestInit];
        expect(url).toBe("/api/db/objects/inventory");
        const body = JSON.parse(options.body as string);
        expect(body.connection.id).toBe("remote-1");
        expect(body.kinds).toEqual(["table"]);
        expect(body.includeColumns).toBe(true);

        expect(mockSaveSchemaSnapshot).toHaveBeenCalledTimes(1);
        const saved = (mockSaveSchemaSnapshot.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
        expect(saved.label).toBe("Live: Remote PG");
        expect(saved.schema).toEqual([
          { name: "users", kind: "table", path: ["public", "users"], columns: [], indexes: [], foreignKeys: [] },
        ]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test("Current Schema is read from the database, not from the prop", async () => {
      // The prop is the copy the explorer last read. Compared against a snapshot taken
      // before a DDL change, a stale copy answers "No differences found" for a change that
      // really happened (#884). The remote side always read the database; this is the same
      // read, for the side that says "current".
      const origFetch = globalThis.fetch;
      const mockFetch = mock((url: string) =>
        Promise.resolve(
          url.includes("provider-meta")
            ? {
                ok: true,
                json: () =>
                  Promise.resolve({
                    capabilities: {
                      queryLanguage: "sql",
                      objectKinds: [{ id: "table", role: "relation", label: "Table", labelPlural: "Tables" }],
                    },
                  }),
              }
            : {
                ok: true,
                json: () =>
                  Promise.resolve({
                    // One object the stale prop does not carry: if the panel is reading the
                    // prop, the diff below cannot see it.
                    objects: [
                      { name: "added_after_the_snapshot", kind: "table", path: ["public", "added_after_the_snapshot"] },
                    ],
                    details: [
                      {
                        path: ["public", "added_after_the_snapshot"],
                        columns: [],
                        indexes: [],
                        foreignKeys: [],
                      },
                    ],
                  }),
              },
        ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      try {
        await act(async () => {
          renderDiff();
        });

        const urls = (mockFetch.mock.calls as unknown[][]).map(([url]) => url);
        expect(urls).toEqual(["/api/db/provider-meta", "/api/db/objects/inventory"]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test("drops the previous connection's objects when the connection changes", async () => {
      // The read runs per connection and the panel stays mounted across a switch, so
      // without a reset "Current Schema" kept the OLD database's objects until the new
      // read landed - and for good if it failed. A snapshot taken in that window is
      // stamped with the new connection and holds the old one's objects, which is the
      // stale-copy defect #884 is about, kept for as long as the snapshot is.
      const origFetch = globalThis.fetch;
      let holdInventory = false;
      const inventory = (name: string) => ({
        ok: true,
        json: () =>
          Promise.resolve({
            objects: [{ name, kind: "table", path: ["public", name] }],
            details: [{ path: ["public", name], columns: [], indexes: [], foreignKeys: [] }],
          }),
      });
      globalThis.fetch = mock((url: string) =>
        url.includes("provider-meta")
          ? Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  capabilities: {
                    queryLanguage: "sql",
                    objectKinds: [{ id: "table", role: "relation", label: "Table", labelPlural: "Tables" }],
                  },
                }),
            })
          : holdInventory
            ? new Promise(() => {})
            : Promise.resolve(inventory("only_on_the_first_connection")),
      ) as unknown as typeof fetch;

      try {
        let rendered!: ReturnType<typeof render>;
        await act(async () => {
          rendered = renderDiff();
        });
        changeTarget("snap-1");
        const first = (mockDiffSchemas.mock.calls as unknown[][]).at(-1)!;
        expect((first[0] as { name: string }[])[0].name).toBe("only_on_the_first_connection");

        // The second connection's read never lands, which is the window that matters.
        holdInventory = true;
        await act(async () => {
          rendered.rerender(<SchemaDiff schema={mockSchema} connection={mockMySQLConnection} />);
        });

        const latest = (mockDiffSchemas.mock.calls as unknown[][]).at(-1)!;
        const names = (latest[0] as { name: string }[]).map((o) => o.name);
        expect(names).not.toContain("only_on_the_first_connection");
        expect(names).toEqual(mockSchema.map((o) => o.name));
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test("says on screen when the current schema could not be read", async () => {
      // The panel falls back to the explorer's copy, and that copy is exactly what #884
      // is about - so a failure that is only a log line lets the panel answer "No
      // differences found" from a stale side with nothing on screen saying so.
      const origFetch = globalThis.fetch;
      const warn = spyOn(logger, "warn").mockImplementation(() => {});
      globalThis.fetch = mock(() =>
        Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "permission denied for schema public" }) }),
      ) as unknown as typeof fetch;

      try {
        let rendered!: ReturnType<typeof render>;
        await act(async () => {
          rendered = renderDiff();
        });
        expect(rendered.container.textContent).toContain("permission denied for schema public");
        expect(rendered.container.textContent).toContain("explorer");
        expect(warn).toHaveBeenCalled();
      } finally {
        globalThis.fetch = origFetch;
        warn.mockRestore();
      }
    });

    test('shows "Fetching..." during remote fetch', async () => {
      const origFetch = globalThis.fetch;
      let resolveFetch!: (v: unknown) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      // The metadata read answers immediately; the inventory is the one held open, because it
      // is the request the spinner is about.
      globalThis.fetch = mock((url: string) =>
        url.includes("provider-meta")
          ? Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  capabilities: {
                    queryLanguage: "sql",
                    objectKinds: [{ id: "table", role: "relation", label: "Table", labelPlural: "Tables" }],
                  },
                }),
            })
          : fetchPromise,
      ) as unknown as typeof fetch;

      try {
        const { queryByText } = renderDiff();
        const fn = getTargetCallback();

        // Start the fetch synchronously, then check for Fetching...
        act(() => {
          fn!("conn:remote-1");
        });

        expect(queryByText("Fetching...")).toBeTruthy();

        // Resolve the fetch
        await act(async () => {
          resolveFetch({ ok: true, json: () => Promise.resolve({ objects: [], details: [] }) });
        });

        expect(queryByText("Fetching...")).toBeNull();
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    test("handles fetch error gracefully", async () => {
      const origFetch = globalThis.fetch;
      // The failure goes to the shared logger, not to `console` — every other
      // component/hook in this tree reports through it, and a bare console call is
      // invisible to whatever the operator has wired the logger up to.
      const warn = spyOn(logger, "warn").mockImplementation(() => {});

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Unauthorized" }),
        }),
      ) as unknown as typeof fetch;

      try {
        renderDiff();
        const fn = getTargetCallback();

        await act(async () => {
          fn!("conn:remote-1");
        });

        expect(warn).toHaveBeenCalled();
        expect(mockSaveSchemaSnapshot).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = origFetch;
        warn.mockRestore();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // formatSnapshotLabel
  // ═══════════════════════════════════════════════════════════════════════════

  describe("formatSnapshotLabel", () => {
    test("snapshot with label shows label", () => {
      const { getAllByText } = renderDiff();
      const matches = getAllByText(/Before migration/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    test("snapshot without label shows connectionName", () => {
      mockGetSchemaSnapshots.mockImplementation(() => [{ ...mockSnapshots[0], label: "" }]);
      const { getAllByText } = renderDiff();
      const matches = getAllByText(/TestDB/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Action Badges (sidebar)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("action badges", () => {
    function renderWithDiff() {
      const result = renderDiff();
      changeTarget("snap-1");
      return result;
    }

    test("added badge has the green hue tint styling", () => {
      const { container } = renderWithDiff();
      const badges = container.querySelectorAll('[data-testid="badge"]');
      const addedBadge = Array.from(badges).find((b) => b.textContent?.includes("Added"));
      expect(addedBadge).toBeTruthy();
      expect(addedBadge!.className).toContain("bg-hue-green-tint/20");
    });

    test("removed badge has the red hue tint styling", () => {
      const { container } = renderWithDiff();
      const badges = container.querySelectorAll('[data-testid="badge"]');
      const removedBadge = Array.from(badges).find((b) => b.textContent?.includes("Removed"));
      expect(removedBadge).toBeTruthy();
      expect(removedBadge!.className).toContain("bg-hue-red-tint/20");
    });

    test("modified badge has the yellow hue tint styling", () => {
      const { container } = renderWithDiff();
      const badges = container.querySelectorAll('[data-testid="badge"]');
      const modifiedBadge = Array.from(badges).find((b) => b.textContent?.includes("Modified"));
      expect(modifiedBadge).toBeTruthy();
      expect(modifiedBadge!.className).toContain("bg-hue-yellow-tint/20");
    });
  });
});
