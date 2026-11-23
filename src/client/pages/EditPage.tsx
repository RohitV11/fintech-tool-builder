import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactGridLayout, { type Layout as GridLayoutItems } from "react-grid-layout/legacy";
import { useContainerWidth } from "react-grid-layout";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import type { AppDefinition, Block } from "../../shared/schema";
import type { SafeCatalog, ValidationError } from "../../shared/catalog-types";
import { validateDefinition } from "../../shared/validate";
import { ApiError, api, type SessionUser } from "../api";
import { blockRegistry } from "../blocks/registry";
import type { RendererContext } from "../blocks/types";
import "react-grid-layout/css/styles.css";
import "../builder.css";

interface DraftResponse {
  definition: AppDefinition;
  version: number;
  validationErrors: ValidationError[];
}

function newBlockId(type: Block["type"]): string {
  return `${type}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function makeBlock(
  type: Block["type"],
  id: string,
  layout: AppDefinition["blocks"][number]["layout"],
  dataset: SafeCatalog["datasets"][number],
  sourceTableId: string,
): Block {
  const config = blockRegistry[type].defaults(dataset);
  switch (type) {
    case "record_table":
      return {
        id,
        type,
        layout,
        config: config as Extract<Block, { type: "record_table" }>["config"],
      };
    case "record_details":
      return {
        id,
        type,
        layout,
        config: {
          ...(config as Extract<Block, { type: "record_details" }>["config"]),
          sourceTableId,
        },
      };
    case "action_button":
      return {
        id,
        type,
        layout,
        config: {
          ...(config as Extract<Block, { type: "action_button" }>["config"]),
          sourceTableId,
        },
      };
    case "audit_history":
      return {
        id,
        type,
        layout,
        config: {
          ...(config as Extract<Block, { type: "audit_history" }>["config"]),
          sourceTableId,
        },
      };
  }
}

function gridLayout(definition: AppDefinition): GridLayoutItems {
  return definition.blocks.map((block) => ({
    i: block.id,
    x: block.layout.x,
    y: block.layout.y,
    w: block.layout.w,
    h: block.layout.h,
  }));
}

interface BuilderGridProps {
  definition: AppDefinition;
  ctx: RendererContext;
  selectedBlockId: string | null;
  setBlockRef: (blockId: string, element: HTMLDivElement | null) => void;
  selectBlock: (blockId: string) => void;
  changeGridLayout: (layout: GridLayoutItems) => void;
  dropBlock: (
    layout: GridLayoutItems,
    item: GridLayoutItems[number] | undefined,
    event: Event,
  ) => void;
}

function BuilderGrid({
  definition,
  ctx,
  selectedBlockId,
  setBlockRef,
  selectBlock,
  changeGridLayout,
  dropBlock,
}: BuilderGridProps) {
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });

  return (
    <section className="builder-canvas-wrap" aria-label="App layout">
      <div className="builder-canvas-label">
        <span>Layout canvas</span>
        <small>12 columns · drag to move · resize from the corner</small>
      </div>
      <div ref={containerRef} className="builder-grid-container">
        {mounted && (
          <ReactGridLayout
            width={width}
            cols={12}
            rowHeight={30}
            compactType={null}
            preventCollision
            isDroppable
            isDraggable
            isResizable
            layout={gridLayout(definition)}
            onLayoutChange={changeGridLayout}
            onDrop={dropBlock}
            onDropDragOver={(event) => {
              const type = (Object.keys(blockRegistry) as Block["type"][]).find((blockType) =>
                event.dataTransfer.types.includes(
                  `application/x-block-type-${blockType.replaceAll("_", "-")}`,
                ),
              );
              return type ? blockRegistry[type].defaultSize : false;
            }}
            droppingItem={{ i: "__dropping-elem__", x: 0, y: 0, w: 4, h: 4 }}
            draggableHandle=".editor-block-handle"
            draggableCancel="input,textarea,button,select,a"
            className="builder-grid"
          >
            {definition.blocks.map((block) => {
              const Renderer = blockRegistry[block.type].Renderer;
              return (
                <div
                  key={block.id}
                  id={`editor-block-${block.id}`}
                  ref={(element) => setBlockRef(block.id, element)}
                  className={`builder-grid-item ${selectedBlockId === block.id ? "selected" : ""}`}
                  tabIndex={0}
                  onClick={() => selectBlock(block.id)}
                  onFocus={() => selectBlock(block.id)}
                >
                  <div className="editor-block-handle">
                    <span>{blockRegistry[block.type].label}</span>
                    <span>{block.id}</span>
                  </div>
                  <Renderer block={block} ctx={ctx} />
                </div>
              );
            })}
          </ReactGridLayout>
        )}
        {!definition.blocks.length && (
          <div className="builder-empty-canvas">
            <strong>Start with a component</strong>
            <span>Choose one from the palette or drag it here.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function EditPage() {
  const { appId = "" } = useParams();
  const navigate = useNavigate();
  const [definition, setDefinition] = useState<AppDefinition | null>(null);
  const [catalog, setCatalog] = useState<SafeCatalog | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [version, setVersion] = useState(0);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadKey, setLoadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const serializedDefinition = useMemo(
    () => (definition ? JSON.stringify(definition) : ""),
    [definition],
  );
  const dirty = Boolean(definition && serializedDefinition !== savedSnapshot);
  const blocker = useBlocker(dirty);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    Promise.all([
      api<DraftResponse>(`/api/apps/${encodeURIComponent(appId)}/draft`),
      api<{ user: SessionUser }>("/api/auth/me"),
      api<SafeCatalog>("/api/catalog"),
    ])
      .then(([draft, session, safeCatalog]) => {
        if (cancelled) return;
        if (session.user.role !== "builder") {
          navigate("/", { replace: true });
          return;
        }
        setDefinition(draft.definition);
        setVersion(draft.version);
        setSavedSnapshot(JSON.stringify(draft.definition));
        setSelectedBlockId(draft.definition.blocks[0]?.id ?? null);
        setUser(session.user);
        setCatalog(safeCatalog);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(cause instanceof Error ? cause.message : "Unable to load this draft");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId, loadKey, navigate]);

  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const dataset = useMemo(
    () => catalog?.datasets.find((entry) => entry.id === definition?.datasetId) ?? null,
    [catalog, definition],
  );
  const validationErrors = useMemo(() => {
    if (!definition || !catalog) return [];
    const validation = validateDefinition(definition, catalog);
    return validation.ok ? [] : validation.errors;
  }, [catalog, definition]);

  const updateBlock = useCallback((blockId: string, update: (block: Block) => Block) => {
    setDefinition((current) =>
      current
        ? {
            ...current,
            blocks: current.blocks.map((block) => (block.id === blockId ? update(block) : block)),
          }
        : current,
    );
  }, []);

  const selectBlock = useCallback((blockId: string) => {
    setSelectedBlockId(blockId);
  }, []);

  const setBlockRef = useCallback((blockId: string, element: HTMLDivElement | null) => {
    blockRefs.current[blockId] = element;
  }, []);

  const addBlock = useCallback(
    (type: Block["type"], position?: { x: number; y: number; w?: number; h?: number }) => {
      if (!definition || !dataset) return;
      if (definition.blocks.length >= 30) {
        setError("An app can contain at most 30 blocks.");
        return;
      }
      const sourceTableId =
        definition.blocks.find((block) => block.type === "record_table")?.id ?? "";
      const size = blockRegistry[type].defaultSize;
      const nextY = Math.max(
        0,
        ...definition.blocks.map((block) => block.layout.y + block.layout.h),
      );
      const block = makeBlock(
        type,
        newBlockId(type),
        {
          x: position?.x ?? 0,
          y: position?.y ?? nextY,
          w: position?.w ?? size.w,
          h: position?.h ?? size.h,
        },
        dataset,
        sourceTableId,
      );
      setDefinition((current) =>
        current ? { ...current, blocks: [...current.blocks, block] } : current,
      );
      setSelectedBlockId(block.id);
      setError("");
    },
    [dataset, definition],
  );

  const ctx = useMemo<RendererContext | null>(() => {
    if (!definition || !dataset || !user) return null;
    return {
      appId,
      revisionId: null,
      mode: "design",
      dataset,
      definition,
      selection: {},
      selectedRecords: {},
      select: () => undefined,
      user,
      stale: false,
      refreshKey: 0,
      bumpRefresh: () => undefined,
      openAction: () => undefined,
    };
  }, [appId, dataset, definition, user]);

  async function saveDraft() {
    if (!definition) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ version: number; validationErrors: ValidationError[] }>(
        `/api/apps/${encodeURIComponent(appId)}/draft`,
        {
          method: "PUT",
          body: JSON.stringify({ definition, expectedVersion: version }),
        },
      );
      setVersion(result.version);
      setSavedSnapshot(serializedDefinition);
      setMessage("Draft saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save this draft");
    } finally {
      setSaving(false);
    }
  }

  async function publishDraft() {
    if (!definition) return;
    setPublishing(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/apps/${encodeURIComponent(appId)}/publish`, {
        method: "POST",
        body: JSON.stringify({ expectedDraftVersion: version }),
      });
      navigate(`/apps/${encodeURIComponent(appId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to publish this draft");
    } finally {
      setPublishing(false);
    }
  }

  function changeDataset(datasetId: string) {
    if (!definition || !catalog || datasetId === definition.datasetId) return;
    const nextDataset = catalog.datasets.find((entry) => entry.id === datasetId);
    if (!nextDataset) return;
    if (
      definition.blocks.length > 0 &&
      !window.confirm("Changing the dataset resets every block's field and action settings. Continue?")
    ) {
      return;
    }
    const tableId = definition.blocks.find((block) => block.type === "record_table")?.id ?? "";
    const blocks = definition.blocks.map((block) => {
      const config = blockRegistry[block.type].defaults(nextDataset);
      return { ...block, config: configWithSource(block.type, config, tableId) } as Block;
    });
    setDefinition({ ...definition, datasetId, blocks });
  }

  function duplicateSelectedBlock() {
    if (!definition || !dataset) return;
    if (definition.blocks.length >= 30) {
      setError("An app can contain at most 30 blocks.");
      return;
    }
    const selected = definition.blocks.find((block) => block.id === selectedBlockId);
    if (!selected) return;
    const nextY = Math.max(0, ...definition.blocks.map((block) => block.layout.y + block.layout.h));
    const duplicate = {
      ...structuredClone(selected),
      id: newBlockId(selected.type),
      layout: { ...selected.layout, y: nextY },
    } as Block;
    setDefinition({ ...definition, blocks: [...definition.blocks, duplicate] });
    setSelectedBlockId(duplicate.id);
  }

  function removeSelectedBlock() {
    if (!definition || !selectedBlockId) return;
    const blocks = definition.blocks.filter((block) => block.id !== selectedBlockId);
    setDefinition({ ...definition, blocks });
    setSelectedBlockId(blocks[0]?.id ?? null);
  }

  function changeGridLayout(layout: GridLayoutItems) {
    if (!definition) return;
    const positions = new Map(layout.map(({ i, x, y, w, h }) => [i, { x, y, w, h }]));
    const blocks = definition.blocks.map((block) => {
      const position = positions.get(block.id);
      if (!position) return block;
      if (
        block.layout.x === position.x &&
        block.layout.y === position.y &&
        block.layout.w === position.w &&
        block.layout.h === position.h
      ) {
        return block;
      }
      return { ...block, layout: position };
    });
    if (blocks.some((block, index) => block !== definition.blocks[index])) {
      setDefinition({ ...definition, blocks });
    }
  }

  function dropBlock(layout: GridLayoutItems, item: GridLayoutItems[number] | undefined, event: Event) {
    const dragEvent = event as DragEvent;
    const type = dragEvent.dataTransfer?.getData("application/x-block-type") as Block["type"] | "";
    if (!type || !Object.hasOwn(blockRegistry, type) || !item) return;
    const position = layout.find(({ i }) => i === item.i) ?? item;
    addBlock(type, position);
  }

  function focusValidationError(validationError: ValidationError) {
    if (!validationError.blockId) return;
    selectBlock(validationError.blockId);
    requestAnimationFrame(() => {
      const element = blockRefs.current[validationError.blockId!];
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.focus();
    });
  }

  const selectedBlock = definition?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedEntry = selectedBlock ? blockRegistry[selectedBlock.type] : null;
  const SelectedInspector = selectedEntry?.Inspector;

  if (loading) {
    return <main className="page-shell"><p className="loading-state">Loading draft…</p></main>;
  }
  if (loadError || !definition || !catalog || !dataset || !ctx) {
    return (
      <main className="page-shell">
        <div className="inline-error" role="alert">
          <span>{loadError || "This draft could not be loaded."}</span>
          <button onClick={() => setLoadKey((value) => value + 1)}>Retry</button>
        </div>
        <Link to="/">Back to apps</Link>
      </main>
    );
  }

  if (viewportWidth < 1024) {
    return (
      <main className="page-shell builder-page">
        <header className="topbar">
          <Link to="/" className="brand">Fintech Tool Builder</Link>
          <Link className="quiet-button" to="/">Back to apps</Link>
        </header>
        <div className="narrow-editor-message" role="status">
          Editing requires a desktop-sized window (at least 1024px wide).
        </div>
      </main>
    );
  }

  return (
    <main className="builder-page">
      <header className="topbar builder-topbar">
        <Link to="/" className="brand">Fintech Tool Builder</Link>
        <span className="role-tag">{user?.displayName} · {user?.role}</span>
      </header>
      <div className="builder-toolbar">
        <div className="builder-title">
          <Link to="/">Apps</Link><span>/</span><strong>App builder</strong>
        </div>
        <div className="builder-toolbar-actions">
          <span className={dirty ? "save-state unsaved" : "save-state"}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button className="quiet-button" disabled={saving || !dirty} onClick={saveDraft}>
            {saving ? "Saving…" : "Save"}
          </button>
          <Link className="quiet-button" to={`/apps/${encodeURIComponent(appId)}/preview`}>Preview</Link>
          <button
            className="primary-button compact"
            disabled={dirty || validationErrors.length > 0 || publishing}
            onClick={publishDraft}
            title={dirty ? "Save your changes before publishing" : undefined}
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
      {(error || message) && (
        <div className={error ? "inline-error builder-message" : "builder-success"} role={error ? "alert" : "status"}>
          <span>{error || message}</span>
          {error && <button onClick={() => setError("")}>Dismiss</button>}
        </div>
      )}
      <div className="builder-settings">
        <label>
          App name
          <input
            maxLength={80}
            value={definition.name}
            onChange={(event) => setDefinition({ ...definition, name: event.target.value })}
          />
        </label>
        <label>
          Dataset
          <select value={definition.datasetId} onChange={(event) => changeDataset(event.target.value)}>
            {catalog.datasets.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <div className="builder-validation-count">
          {validationErrors.length === 0
            ? "Definition is valid"
            : `${validationErrors.length} validation ${validationErrors.length === 1 ? "issue" : "issues"}`}
        </div>
      </div>
      <div className="builder-workspace">
        <aside className="builder-palette" aria-label="Block palette">
          <div className="builder-panel-heading"><h2>Components</h2><span>Drag onto canvas</span></div>
          {Object.values(blockRegistry).map((entry) => (
            <button
              key={entry.type}
              className="palette-item"
              draggable
              onClick={() => addBlock(entry.type)}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-block-type", entry.type);
                event.dataTransfer.setData(
                  `application/x-block-type-${entry.type.replaceAll("_", "-")}`,
                  entry.type,
                );
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <strong>{entry.label}</strong>
              <small>Click or drag to add</small>
            </button>
          ))}
          {validationErrors.length > 0 && (
            <section className="validation-list" aria-label="Validation errors">
              <h3>Resolve before publishing</h3>
              <ul>
                {validationErrors.map((validationError, index) => (
                  <li key={`${validationError.path}-${index}`}>
                    <button onClick={() => focusValidationError(validationError)}>
                      {validationError.message}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
        <BuilderGrid
          definition={definition}
          ctx={ctx}
          selectedBlockId={selectedBlockId}
          setBlockRef={setBlockRef}
          selectBlock={selectBlock}
          changeGridLayout={changeGridLayout}
          dropBlock={dropBlock}
        />
        <aside className="builder-inspector" aria-label="Block inspector">
          <div className="builder-panel-heading"><h2>Inspector</h2></div>
          {selectedBlock && SelectedInspector ? (
            <>
              <div className="selected-block-title">
                <strong>{selectedEntry?.label}</strong>
                <small>{selectedBlock.id}</small>
              </div>
              <div className="inspector-fields">
                <label>
                  X
                  <input
                    type="number"
                    min={0}
                    max={11}
                    value={selectedBlock.layout.x}
                    onChange={(event) =>
                      updateBlock(selectedBlock.id, (block) => ({
                        ...block,
                        layout: { ...block.layout, x: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
                <label>
                  Y
                  <input
                    type="number"
                    min={0}
                    value={selectedBlock.layout.y}
                    onChange={(event) =>
                      updateBlock(selectedBlock.id, (block) => ({
                        ...block,
                        layout: { ...block.layout, y: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
                <label>
                  Width
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={selectedBlock.layout.w}
                    onChange={(event) =>
                      updateBlock(selectedBlock.id, (block) => ({
                        ...block,
                        layout: { ...block.layout, w: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
                <label>
                  Height
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={selectedBlock.layout.h}
                    onChange={(event) =>
                      updateBlock(selectedBlock.id, (block) => ({
                        ...block,
                        layout: { ...block.layout, h: Number(event.target.value) },
                      }))
                    }
                  />
                </label>
              </div>
              <SelectedInspector
                config={selectedBlock.config}
                dataset={dataset}
                definition={definition}
                onChange={(config) =>
                  updateBlock(selectedBlock.id, (block) => ({ ...block, config }) as Block)
                }
              />
              <div className="inspector-actions">
                <button className="quiet-button" onClick={duplicateSelectedBlock}>Duplicate block</button>
                <button className="danger-outline-button" onClick={removeSelectedBlock}>Remove block</button>
              </div>
            </>
          ) : (
            <p className="muted inspector-empty">Select a component on the canvas to edit it.</p>
          )}
        </aside>
      </div>
      {blocker.state === "blocked" && (
        <div className="modal-backdrop" role="presentation">
          <section className="dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="leave-title">
            <h2 id="leave-title">Leave without saving?</h2>
            <p className="muted">Your unsaved changes will be lost.</p>
            <div className="dialog-actions">
              <button className="quiet-button" onClick={() => blocker.reset()}>Keep editing</button>
              <button className="danger-button" onClick={() => blocker.proceed()}>Leave page</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function configWithSource(
  type: Block["type"],
  config: Block["config"],
  sourceTableId: string,
): Block["config"] {
  if (type === "record_table") return config;
  return { ...config, sourceTableId } as Block["config"];
}
