import type { ComponentType } from "react";
import type { z } from "zod";
import type {
  AppDefinition,
  Block,
  ActionButtonBlock,
} from "../../shared/schema";
import type { CatalogDataset } from "../../shared/catalog-types";
import type { SessionUser } from "../api";

export type RenderMode = "runtime" | "preview" | "design";

export interface RendererContext {
  appId: string;
  revisionId: string | null;
  mode: RenderMode;
  dataset: CatalogDataset;
  definition: AppDefinition;
  selection: Record<string, string | null>;
  selectedRecords: Record<string, Record<string, unknown> | undefined>;
  select(
    tableId: string,
    recordId: string | null,
    record?: Record<string, unknown>,
  ): void;
  user: SessionUser;
  stale: boolean;
  refreshKey: number;
  bumpRefresh(): void;
  openAction(block: ActionButtonBlock, record: Record<string, unknown>): void;
}

export interface RendererProps {
  block: Block;
  ctx: RendererContext;
}

export interface InspectorProps {
  config: Block["config"];
  onChange(config: Block["config"]): void;
  dataset: CatalogDataset;
  definition: AppDefinition;
}

export interface BlockRegistryEntry {
  type: Block["type"];
  label: string;
  configSchema: z.ZodType;
  defaults(dataset: CatalogDataset): Block["config"];
  defaultSize: { w: number; h: number };
  Inspector: ComponentType<InspectorProps>;
  Renderer: ComponentType<RendererProps>;
}
