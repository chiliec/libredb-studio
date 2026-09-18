"use client";

import { appFetch } from "@/lib/config/base-path";
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useReadGeneration } from "@/hooks/use-read-generation";
import {
  GitCompare,
  Plus,
  Minus,
  PenLine,
  Camera,
  FileCode,
  ChevronRight,
  ChevronDown,
  Clock,
  Database,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SchemaSnapshot, DatabaseType, DatabaseConnection } from "@/lib/types";
import { detailedObjects, type DetailedObject } from "@/lib/db/detailed-object";
import { relationKindIds } from "@/lib/db/object-kinds";
import type { ProviderCapabilities } from "@/lib/db/types";
import { storage } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { useAllConnections } from "@/hooks/use-all-connections";
import { diffSchemas } from "@/lib/schema-diff/diff-engine";
import { generateMigrationSQL } from "@/lib/schema-diff/migration-generator";
import type { SchemaDiff as SchemaDiffType, TableDiff } from "@/lib/schema-diff/types";
import { SnapshotTimeline } from "@/components/SnapshotTimeline";

interface SchemaDiffProps {
  schema: readonly DetailedObject[];
  connection: DatabaseConnection | null;
}

/**
 * Read one connection's objects from the database.
 *
 * Two reads of the object surface, where this used to be one call to
 * `POST /api/db/schema-snapshot` (#789). That route read the flat schema, which no longer
 * exists, and the two things it hand-rolled around that read are things `getOrCreateProvider`
 * does for every object route already: it opens the SSH tunnel (#457), and it returns the
 * handle this connection already holds rather than opening a second one, which is what #498
 * needed on an engine that admits only one writer to its file.
 *
 * `provider-meta` decides which kinds are asked for, exactly as the object browser's own read
 * does, and for the same measured reason: a diff is over relations, and asking for every
 * declared kind would list routines and triggers this comparison cannot use.
 *
 * It sits outside the component because BOTH sides of a diff need it. The remote side always
 * called it; the "Current Schema" side read a prop instead, so a diff taken right after a DDL
 * change compared the database against a copy of itself from before the change and reported
 * no differences (#884).
 */
async function readLiveSchema(conn: DatabaseConnection): Promise<DetailedObject[]> {
  const payload = conn.managed && conn.seedId ? { connectionId: `seed:${conn.seedId}` } : { connection: conn };
  const post = (path: string, body: unknown) =>
    appFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const metaRes = await post("/api/db/provider-meta", payload);
  const meta = await metaRes.json();
  if (!metaRes.ok) throw new Error(meta.error);
  const kinds = relationKindIds(meta.capabilities as ProviderCapabilities);
  if (kinds.length === 0) throw new Error(`${conn.name} declares no object kinds a schema diff can compare`);

  const res = await post("/api/db/objects/inventory", { ...payload, kinds, includeColumns: true });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);

  return [...detailedObjects(data.objects ?? [], data.details ?? [])];
}

export function SchemaDiff({ schema, connection }: SchemaDiffProps) {
  const [snapshots, setSnapshots] = useState<SchemaSnapshot[]>(() => storage.getSchemaSnapshots());
  const [sourceId, setSourceId] = useState<string>("current");
  const [targetId, setTargetId] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [showMigration, setShowMigration] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [showLabelInput, setShowLabelInput] = useState(false);
  /** True while a snapshot's own read is in flight. State, because the button reads it. */
  const [snapshotting, setSnapshotting] = useState(false);
  /**
   * The same fact as a ref, because the GUARD cannot read the state.
   *
   * Two Enter presses land in the same tick, before React has re-rendered, so both see the
   * `snapshotting` the callback closed over — `false` — and both save. A ref is written and
   * read synchronously, which is what a re-entrancy guard needs.
   */
  const snapshotInFlight = useRef(false);
  /**
   * The reason the last snapshot was not saved, and the connection it was about.
   *
   * Carried together for the reason `liveRead` is: a failure on the connection the user has
   * left is not a failure of the one they are looking at, and a banner about the other
   * database over a working panel is its own small lie. Derived rather than cleared by an
   * effect, so there is no render where the wrong one is on screen.
   */
  const [snapshotFailure, setSnapshotFailure] = useState<{ connectionId: string; reason: string } | null>(null);

  /**
   * Which read is the current one.
   *
   * Three things read this connection now - the panel opening, a snapshot, and a target
   * being chosen to compare against - and any of them can settle after another has already
   * started. A counter is what settles that, and the repository already states the rule
   * once in `useReadGeneration`: begin a read, and every write it performs asks first
   * whether it is still the one that matters.
   *
   * Comparing the connection OBJECT instead was the earlier attempt and it is not safe:
   * `use-connection-adapter.ts` builds `activeConnection` with a `useMemo` over a prop the
   * embedded host supplies, so a host that hands over a fresh array per render produces a
   * fresh object per render, and a read would then be discarded on a connection that never
   * changed - the snapshot silently not saved, with nothing on screen.
   */
  const reads = useReadGeneration();

  /**
   * The objects the database holds, and the connection they were read FROM.
   *
   * Carried together rather than cleared on a switch, because the panel outlives one:
   * holding the previous database's objects made "Current Schema" mean the OTHER connection
   * until the new read landed, and for good if that read failed.
   *
   * `error` is the other half. The panel falls back to the explorer's copy, and that copy is
   * precisely what #884 is about, so the reason is state that reaches the screen rather than
   * a log line that reaches nobody standing in front of the panel.
   */
  const [liveRead, setLiveRead] = useState<{
    connection: DatabaseConnection;
    objects: readonly DetailedObject[] | null;
    error: string | null;
  } | null>(null);

  const readForThisConnection = liveRead?.connection.id === connection?.id ? liveRead : null;
  const liveSchema = readForThisConnection?.objects ?? null;
  const liveSchemaError = readForThisConnection?.error ?? null;
  const snapshotError =
    snapshotFailure !== null && snapshotFailure.connectionId === connection?.id ? snapshotFailure.reason : null;

  /**
   * Begin a read of this connection, and hand back both the promise and the question every
   * write it performs has to ask first.
   *
   * The write is left to the caller rather than done here, and deliberately: a `setState`
   * reached through a helper called straight from an effect is what the React lint rules
   * forbid, and the shape they accept - settle first, then write - is also the honest one,
   * because the two callers want different things from a failure. The panel opening falls
   * back to the explorer's copy and says so; a snapshot saves nothing at all.
   */
  const beginRead = useCallback(
    (conn: DatabaseConnection) => ({ read: readLiveSchema(conn), isCurrent: reads.begin() }),
    [reads],
  );

  useEffect(() => {
    if (!connection) return;
    const { read, isCurrent } = beginRead(connection);
    read
      .then((objects) => {
        if (!isCurrent()) return;
        setLiveRead({ connection, objects, error: null });
        // A reading of this database that worked settles the last one that did not: leaving
        // it up meant a banner about a failure the user had already walked away from.
        setSnapshotFailure((previous) => (previous?.connectionId === connection.id ? null : previous));
      })
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        if (isCurrent()) setLiveRead({ connection, objects: null, error: reason });
        logger.warn("Failed to read the current schema for a diff; falling back to the explorer's copy", {
          route: "SchemaDiff",
          error: reason,
        });
      });
  }, [connection, beginRead]);

  /**
   * A comparison reads the database again.
   *
   * Without this the panel answers the question it was opened with rather than the one being
   * asked: take a snapshot, change the database, pick that snapshot as the target, and both
   * sides are the moment of the snapshot - "No differences found" again, which is the whole
   * defect wearing different clothes. The read happens when a target is CHOSEN, because that
   * is the moment a person asks to be told the difference.
   */
  useEffect(() => {
    // Only when one side of the comparison IS the database. Two snapshots against each
    // other are two files; reading the connection for them is a round trip that changes
    // nothing either side shows.
    if (!connection || !targetId) return;
    if (sourceId !== "current" && targetId !== "current") return;
    const { read, isCurrent } = beginRead(connection);
    read
      .then((objects) => {
        if (!isCurrent()) return;
        setLiveRead({ connection, objects, error: null });
        // Same rule as the read when the panel opens: a reading of this database that worked
        // settles the last one that did not.
        setSnapshotFailure((previous) => (previous?.connectionId === connection.id ? null : previous));
      })
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        // Falling back to the last copy rather than emptying the side, which would report
        // every object as removed; the banner says why it may be out of date.
        if (isCurrent()) setLiveRead({ connection, objects: null, error: reason });
      });
  }, [targetId, sourceId, connection, beginRead]);

  /** What "Current Schema" means on both sides of the diff, and in a new snapshot. */
  const currentSchema = liveSchema ?? schema;

  /**
   * Freeze the schema the database holds AT THIS MOMENT, not the one the panel read when
   * it opened.
   *
   * #884 moved "Current Schema" off the explorer's copy and onto a read of the connection,
   * but that read sits in an effect keyed on `[connection]` alone, so it happens once and
   * not again for as long as the panel stays open. The sequence the Diff tab exists for —
   * snapshot, change the database, compare — still answered "No differences found": the
   * snapshot froze that first copy, and so did the other side of the comparison. Measured
   * against PostgreSQL 16 with the panel left open. Leaving the tab and coming back was
   * the only thing that helped, and it helped because `BottomPanel` mounts one view at a
   * time, so returning is a remount and the effect runs again — not a step anyone would
   * guess, and not one the panel tells you about.
   *
   * Reading here fixes both halves at once, because the same read becomes the new
   * `liveRead`: the snapshot records the database, and the "Current Schema" it will be
   * compared against is refreshed to the same instant.
   *
   * A read that fails saves NOTHING. A snapshot is kept to be compared against later, so a
   * silently stale one is the defect again with a longer fuse; the banner says why and the
   * label stays typed so the button can be pressed again.
   */
  const takeSnapshot = useCallback(async () => {
    if (!connection || snapshotInFlight.current) return;
    snapshotInFlight.current = true;
    setSnapshotting(true);
    setSnapshotFailure(null);
    try {
      // The same read that becomes "Current Schema", so the snapshot and the side it will
      // be compared against are the same instant.
      const { read, isCurrent } = beginRead(connection);
      const objects = await read;
      if (!isCurrent()) {
        // Something asked for a newer read while this one was in flight - choosing a target
        // does, on this same connection. Returning quietly here saved nothing and said
        // nothing, so the button came back to "Save" and the user believed it had. The
        // banner stays until the next attempt: a later read landing is not a snapshot, and
        // clearing it on one put the silence straight back.
        setSnapshotFailure({
          connectionId: connection.id,
          reason: "the schema was read again before this finished. Press Save again",
        });
        return;
      }
      setLiveRead({ connection, objects, error: null });
      const snapshot: SchemaSnapshot = {
        id: Date.now().toString(),
        connectionId: connection.id,
        connectionName: connection.name,
        databaseType: connection.type,
        schema: JSON.parse(JSON.stringify(objects)),
        createdAt: new Date(),
        label: snapshotLabel.trim() || undefined,
      };
      // Inside the try as well: snapshots live in localStorage and a snapshot is a whole
      // schema, so a quota refusal is an ordinary outcome rather than an exotic one.
      // Inside the try, so a write that throws reaches the same banner the read failure
      // does rather than escaping as an unhandled rejection.
      //
      // It does NOT catch a full disk. `storage.saveSchemaSnapshot` returns nothing and
      // `local-storage.ts` swallows the quota error, so a refused write is reported here as
      // a snapshot taken. That is the store's to fix - every caller of it has the same
      // problem and none of them can see the failure - and it predates this change.
      storage.saveSchemaSnapshot(snapshot);
      setSnapshots(storage.getSchemaSnapshots());
      setSnapshotLabel("");
      setShowLabelInput(false);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setSnapshotFailure({ connectionId: connection.id, reason });
      logger.warn("Nothing was saved for this snapshot", { route: "SchemaDiff", error: reason });
    } finally {
      // In `finally`, not at the end of each branch: a throw between them would otherwise
      // leave the button reading "Reading..." for the life of the panel, with nothing on
      // screen saying why, and `snapshotInFlight` stuck true so no later press does anything.
      snapshotInFlight.current = false;
      setSnapshotting(false);
    }
  }, [connection, snapshotLabel, beginRead]);

  // Delete snapshot
  const deleteSnapshot = useCallback(
    (id: string) => {
      storage.deleteSchemaSnapshot(id);
      setSnapshots(storage.getSchemaSnapshots());
      if (sourceId === id) setSourceId("current");
      if (targetId === id) setTargetId("");
    },
    [sourceId, targetId],
  );

  // Compute diff
  const diff = useMemo<SchemaDiffType | null>(() => {
    if (!targetId) return null;

    const sourceSchema =
      sourceId === "current" ? currentSchema : snapshots.find((s) => s.id === sourceId)?.schema || [];

    const targetSchema =
      targetId === "current" ? currentSchema : snapshots.find((s) => s.id === targetId)?.schema || [];

    if (sourceId === targetId) return null;

    return diffSchemas(sourceSchema, targetSchema);
  }, [sourceId, targetId, currentSchema, snapshots]);

  // Generate migration SQL
  const migrationSQL = useMemo(() => {
    if (!diff || !diff.hasChanges) return "";
    const dialect = connection?.type || "postgres";
    return generateMigrationSQL(diff, dialect as DatabaseType);
  }, [diff, connection]);

  // Get all connections for cross-connection comparison
  const { connections: allConnections } = useAllConnections();
  const [fetchingRemote, setFetchingRemote] = useState(false);

  // Fetch schema from a remote connection
  const fetchRemoteSchema = useCallback(
    async (connId: string) => {
      const conn = allConnections.find((c) => c.id === connId);
      if (!conn) return;

      setFetchingRemote(true);
      try {
        const objects = await readLiveSchema(conn);

        // Auto-save as snapshot
        const snapshot: SchemaSnapshot = {
          id: `remote-${Date.now()}`,
          connectionId: conn.id,
          connectionName: conn.name,
          databaseType: conn.type,
          schema: objects,
          createdAt: new Date(),
          label: `Live: ${conn.name}`,
        };
        storage.saveSchemaSnapshot(snapshot);
        setSnapshots(storage.getSchemaSnapshots());
        setTargetId(snapshot.id);
      } catch (err) {
        logger.warn("Failed to fetch the remote schema for a diff", {
          route: "SchemaDiff",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setFetchingRemote(false);
      }
    },
    [allConnections],
  );

  const getActionBadge = (action: string) => {
    switch (action) {
      case "added":
        return (
          <Badge className="bg-hue-green-tint/20 text-hue-green border-hue-green-tint/30 text-xs">
            <Plus strokeWidth={1.5} className="w-2.5 h-2.5 mr-0.5" />
            {"Added"}
          </Badge>
        );
      case "removed":
        return (
          <Badge className="bg-hue-red-tint/20 text-hue-red border-hue-red-tint/30 text-xs">
            <Minus className="w-2.5 h-2.5 mr-0.5" />
            {"Removed"}
          </Badge>
        );
      case "modified":
        return (
          <Badge className="bg-hue-yellow-tint/20 text-hue-yellow border-hue-yellow-tint/30 text-xs">
            <PenLine strokeWidth={1.5} className="w-2.5 h-2.5 mr-0.5" />
            {"Modified"}
          </Badge>
        );
      default:
        return null;
    }
  };

  const formatSnapshotLabel = (s: SchemaSnapshot) => {
    const date = new Date(s.createdAt).toLocaleString();
    return `${s.label || s.connectionName} (${date})`;
  };

  return (
    <div className="h-full flex flex-col bg-sunken">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline bg-surface flex-wrap">
        <GitCompare strokeWidth={1.5} className="w-3.5 h-3.5 text-hue-rose" />
        <span className="text-xs font-medium text-fg-tertiary">Schema Diff</span>

        <div className="h-4 w-px bg-fill-strong" />

        {/* Source selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-fg-subtle">Source</span>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger className="h-7 w-[180px] text-xs bg-fill border-hairline-strong">
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent className="bg-overlay border-hairline-strong">
              <SelectItem value="current" className="text-xs">
                <div className="flex items-center gap-1">
                  <Database strokeWidth={1.5} className="w-3 h-3" /> Current Schema
                </div>
              </SelectItem>
              {snapshots.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  <div className="flex items-center gap-1">
                    <Clock strokeWidth={1.5} className="w-3 h-3" /> {formatSnapshotLabel(s)}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-fg-subtle text-xs">vs</span>

        {/* Target selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-fg-subtle">Target</span>
          <Select
            value={targetId}
            onValueChange={(v) => {
              if (v.startsWith("conn:")) {
                fetchRemoteSchema(v.replace("conn:", ""));
              } else {
                setTargetId(v);
              }
            }}
          >
            <SelectTrigger className="h-7 w-[180px] text-xs bg-fill border-hairline-strong">
              <SelectValue placeholder="Select target" />
            </SelectTrigger>
            <SelectContent className="bg-overlay border-hairline-strong">
              <SelectItem value="current" className="text-xs">
                <div className="flex items-center gap-1">
                  <Database strokeWidth={1.5} className="w-3 h-3" /> Current Schema
                </div>
              </SelectItem>
              {snapshots.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  <div className="flex items-center gap-1">
                    <Clock strokeWidth={1.5} className="w-3 h-3" /> {formatSnapshotLabel(s)}
                  </div>
                </SelectItem>
              ))}
              {allConnections.filter((c) => c.id !== connection?.id).length > 0 && (
                <>
                  <div className="px-2 py-1 text-[0.625rem] text-fg-subtle border-t border-hairline mt-1">
                    {"Fetch from connection"}
                  </div>
                  {allConnections
                    .filter((c) => c.id !== connection?.id)
                    .map((c) => (
                      <SelectItem key={`conn:${c.id}`} value={`conn:${c.id}`} className="text-xs">
                        <div className="flex items-center gap-1">
                          <Database strokeWidth={1.5} className="w-3 h-3 text-hue-blue" /> {c.name}
                          {c.environment === "production" && (
                            <TriangleAlert strokeWidth={1.5} className="w-3 h-3 text-danger" />
                          )}
                        </div>
                      </SelectItem>
                    ))}
                </>
              )}
            </SelectContent>
          </Select>
          {fetchingRemote && <span className="text-xs text-fg-muted animate-pulse">Fetching...</span>}
        </div>

        <div className="flex-1" />

        {/* Snapshot controls */}
        {showLabelInput ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="Label (optional)..."
              value={snapshotLabel}
              onChange={(e) => setSnapshotLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && takeSnapshot()}
              disabled={snapshotting}
              className="h-7 px-2 text-xs bg-fill border border-hairline-strong rounded text-fg-secondary focus:outline-none focus:border-brand-tint w-32 disabled:opacity-60"
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-brand"
              onClick={takeSnapshot}
              disabled={snapshotting}
            >
              {snapshotting ? "Reading..." : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-fg-muted"
              // Closed while a read is in flight: the panel would go away and the snapshot
              // would still be written, which is a save nobody is watching for.
              disabled={snapshotting}
              onClick={() => setShowLabelInput(false)}
            >
              {"Cancel"}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs font-medium text-fg-muted hover:text-fg-bright gap-1"
            onClick={() => setShowLabelInput(true)}
            disabled={!connection}
          >
            <Camera className="w-3 h-3" /> Snapshot
          </Button>
        )}

        {diff?.hasChanges && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs font-medium text-fg-muted hover:text-fg-bright gap-1"
            onClick={() => setShowMigration(!showMigration)}
          >
            <FileCode className="w-3 h-3" /> {showMigration ? "Diff View" : "SQL Migration"}
          </Button>
        )}
      </div>

      {liveSchemaError && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hairline bg-warning-tint/10 text-warning">
          <TriangleAlert strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs">
            {`Current Schema is the explorer's last copy, which may be out of date: ${liveSchemaError}`}
          </span>
        </div>
      )}

      {/* Its own line, because the panel's read can be failing at the same time and the two
          are different facts: one says what Current Schema means, the other says a snapshot
          you asked for was not written. Showing only the first left the second silent. */}
      {snapshotError !== null && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hairline bg-warning-tint/10 text-warning">
          <TriangleAlert strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs">{`No snapshot was saved: ${snapshotError}`}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {!targetId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-fg-subtle gap-3">
            <GitCompare strokeWidth={1.5} className="w-10 h-10 opacity-30" />
            <p className="text-xs">Select source and target to compare schemas</p>
            <p className="text-xs text-fg-faint">Take a snapshot first, then compare with the current schema</p>

            {/* Snapshot Timeline */}
            {snapshots.length > 0 && (
              <div className="mt-4 w-full max-w-2xl px-4">
                <SnapshotTimeline
                  snapshots={snapshots}
                  onCompare={(sourceId, targetId) => {
                    setSourceId(sourceId);
                    setTargetId(targetId);
                  }}
                  onDelete={deleteSnapshot}
                />
              </div>
            )}
          </div>
        ) : showMigration && migrationSQL ? (
          <div className="flex-1 overflow-auto p-4">
            <pre className="text-xs font-mono text-fg-secondary bg-raised border border-hairline-strong rounded-lg p-4 overflow-auto whitespace-pre-wrap">
              {migrationSQL}
            </pre>
          </div>
        ) : diff && diff.hasChanges ? (
          <>
            {/* Table List */}
            <div className="w-64 border-r border-hairline overflow-auto">
              <div className="p-2 border-b border-hairline">
                <div className="text-xs text-fg-muted px-2 mb-1">
                  {diff.summary.added} added, {diff.summary.removed} removed, {diff.summary.modified} modified
                </div>
              </div>
              {diff.tables.map((table) => (
                <button
                  key={table.tableName}
                  onClick={() => setSelectedTable(table.tableName)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-fill transition-colors",
                    selectedTable === table.tableName && "bg-fill-strong",
                  )}
                >
                  {selectedTable === table.tableName ? (
                    <ChevronDown strokeWidth={1.5} className="w-3 h-3 text-fg-muted" />
                  ) : (
                    <ChevronRight strokeWidth={1.5} className="w-3 h-3 text-fg-muted" />
                  )}
                  <span className="text-fg-secondary">{table.tableName}</span>
                  <span className="ml-auto">{getActionBadge(table.action)}</span>
                </button>
              ))}
            </div>

            {/* Table Detail */}
            <div className="flex-1 overflow-auto p-4">
              {selectedTable ? (
                <TableDiffDetail diff={diff.tables.find((t) => t.tableName === selectedTable)!} />
              ) : (
                <div className="h-full flex items-center justify-center text-fg-subtle text-xs">
                  {"Select a table to view diff details"}
                </div>
              )}
            </div>
          </>
        ) : diff && !diff.hasChanges ? (
          <div className="flex-1 flex items-center justify-center text-fg-subtle gap-2">
            <span className="text-xs">No differences found between source and target</span>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-fg-subtle gap-2">
            <TriangleAlert strokeWidth={1.5} className="w-3.5 h-3.5" />
            <span className="text-xs">Cannot compare same schema with itself</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TableDiffDetail({ diff }: { diff: TableDiff }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database strokeWidth={1.5} className="w-3.5 h-3.5 text-fg-tertiary" />
        <h3 className="text-xs font-medium text-fg">{diff.tableName}</h3>
        <Badge
          className={cn(
            "text-xs",
            diff.action === "added" && "bg-hue-green-tint/20 text-hue-green",
            diff.action === "removed" && "bg-hue-red-tint/20 text-hue-red",
            diff.action === "modified" && "bg-hue-yellow-tint/20 text-hue-yellow",
          )}
        >
          {diff.action}
        </Badge>
      </div>

      {/* Columns */}
      {diff.columns.length > 0 && (
        <div>
          <h4 className="text-xs text-fg-muted mb-2 font-medium">Columns</h4>
          <div className="space-y-1">
            {/* Keyed by the name the row is ABOUT, not by its position: the diff is
                recomputed whenever either side changes, and the rows come back in a
                different order, which had React reusing one column's row for another's.
                The inner `changes` lists are keyed by their own text — each entry names a
                different attribute ("Type changed:", "Nullable changed:", …), so the text
                is unique within a row and survives a reorder the way the index did not. */}
            {diff.columns.map((col) => (
              <div
                key={col.columnName}
                className={cn(
                  "px-3 py-2 rounded text-xs flex items-center gap-2",
                  col.action === "added" && "bg-hue-green-tint/5 border border-hue-green-tint/10",
                  col.action === "removed" && "bg-hue-red-tint/5 border border-hue-red-tint/10",
                  col.action === "modified" && "bg-hue-yellow-tint/5 border border-hue-yellow-tint/10",
                )}
              >
                <span className="font-mono text-fg-secondary min-w-[120px]">{col.columnName}</span>
                {col.action === "modified" && (
                  <div className="flex flex-col gap-0.5">
                    {col.changes.map((change) => (
                      <span key={change} className="text-xs text-fg-muted">
                        {change}
                      </span>
                    ))}
                  </div>
                )}
                {col.action === "added" && <span className="text-xs text-hue-green font-mono">{col.targetType}</span>}
                {col.action === "removed" && <span className="text-xs text-hue-red font-mono">{col.sourceType}</span>}
                <span className="ml-auto">{getActionIcon(col.action)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Indexes */}
      {diff.indexes.length > 0 && (
        <div>
          <h4 className="text-xs text-fg-muted mb-2 font-medium">Indexes</h4>
          <div className="space-y-1">
            {diff.indexes.map((idx) => (
              <div
                key={idx.indexName}
                className={cn(
                  "px-3 py-2 rounded text-xs flex items-center gap-2",
                  idx.action === "added" && "bg-hue-green-tint/5 border border-hue-green-tint/10",
                  idx.action === "removed" && "bg-hue-red-tint/5 border border-hue-red-tint/10",
                  idx.action === "modified" && "bg-hue-yellow-tint/5 border border-hue-yellow-tint/10",
                )}
              >
                <span className="font-mono text-fg-secondary">{idx.indexName}</span>
                {idx.changes.map((change) => (
                  <span key={change} className="text-xs text-fg-muted">
                    {change}
                  </span>
                ))}
                <span className="ml-auto">{getActionIcon(idx.action)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Foreign Keys */}
      {diff.foreignKeys.length > 0 && (
        <div>
          <h4 className="text-xs text-fg-muted mb-2 font-medium">Foreign Keys</h4>
          <div className="space-y-1">
            {/* Keyed by the action as well as the column: a foreign key repointed at
                another table is TWO entries under one column name, because the diff
                engine keys an FK by `columnName→table.column` and reports the old one
                removed and the new one added. The column name alone gave React two
                children with the same key. */}
            {diff.foreignKeys.map((fk) => (
              <div
                key={`${fk.action}:${fk.columnName}`}
                className={cn(
                  "px-3 py-2 rounded text-xs flex items-center gap-2",
                  fk.action === "added" && "bg-hue-green-tint/5 border border-hue-green-tint/10",
                  fk.action === "removed" && "bg-hue-red-tint/5 border border-hue-red-tint/10",
                )}
              >
                <span className="font-mono text-fg-secondary">{fk.columnName}</span>
                {fk.changes.map((change) => (
                  <span key={change} className="text-xs text-fg-muted">
                    {change}
                  </span>
                ))}
                <span className="ml-auto">{getActionIcon(fk.action)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getActionIcon(action: string) {
  switch (action) {
    case "added":
      return <Plus strokeWidth={1.5} className="w-3 h-3 text-hue-green" />;
    case "removed":
      return <Minus className="w-3 h-3 text-hue-red" />;
    case "modified":
      return <PenLine strokeWidth={1.5} className="w-3 h-3 text-hue-yellow" />;
    default:
      return null;
  }
}
