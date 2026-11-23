import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const LayoutSchema = z
  .object({
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(40),
  })
  .strict()
  .superRefine((layout, context) => {
    if (layout.x + layout.w > 12) {
      context.addIssue({
        code: "custom",
        path: ["w"],
        message: "Block must fit within the 12-column grid",
      });
    }
  });

const BlockBaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  layout: LayoutSchema,
});

export const RecordTableConfigSchema = z
  .object({
    title: z.string().min(1).max(80),
    columns: z.array(z.string()).min(1),
    defaultStatusFilter: z.string().nullable(),
    pageSize: z.union([z.literal(5), z.literal(10), z.literal(25)]).default(10),
  })
  .strict();

export const RecordDetailsConfigSchema = z
  .object({
    title: z.string().min(1).max(80),
    fields: z.array(z.string()).min(1),
    sourceTableId: z.string(),
  })
  .strict();

export const ActionButtonConfigSchema = z
  .object({
    label: z.string().min(1).max(40),
    actionId: z.string(),
    sourceTableId: z.string(),
  })
  .strict();

export const AuditHistoryConfigSchema = z
  .object({
    title: z.string().min(1).max(80),
    sourceTableId: z.string(),
  })
  .strict();

export const RecordTableBlockSchema = BlockBaseSchema.extend({
  type: z.literal("record_table"),
  config: RecordTableConfigSchema,
}).strict();

export const RecordDetailsBlockSchema = BlockBaseSchema.extend({
  type: z.literal("record_details"),
  config: RecordDetailsConfigSchema,
}).strict();

export const ActionButtonBlockSchema = BlockBaseSchema.extend({
  type: z.literal("action_button"),
  config: ActionButtonConfigSchema,
}).strict();

export const AuditHistoryBlockSchema = BlockBaseSchema.extend({
  type: z.literal("audit_history"),
  config: AuditHistoryConfigSchema,
}).strict();

export const BlockSchema = z.discriminatedUnion("type", [
  RecordTableBlockSchema,
  RecordDetailsBlockSchema,
  ActionButtonBlockSchema,
  AuditHistoryBlockSchema,
]);

export const AppDefinitionSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    name: z.string().min(1).max(80),
    datasetId: z.string().min(1),
    blocks: z.array(BlockSchema).max(30),
  })
  .strict();

export const ExecuteBodySchema = z
  .object({
    recordId: z.string().min(1),
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().min(3).max(500),
    revisionId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export type Layout = z.infer<typeof LayoutSchema>;
export type RecordTableConfig = z.infer<typeof RecordTableConfigSchema>;
export type RecordDetailsConfig = z.infer<typeof RecordDetailsConfigSchema>;
export type ActionButtonConfig = z.infer<typeof ActionButtonConfigSchema>;
export type AuditHistoryConfig = z.infer<typeof AuditHistoryConfigSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type RecordTableBlock = z.infer<typeof RecordTableBlockSchema>;
export type RecordDetailsBlock = z.infer<typeof RecordDetailsBlockSchema>;
export type ActionButtonBlock = z.infer<typeof ActionButtonBlockSchema>;
export type AuditHistoryBlock = z.infer<typeof AuditHistoryBlockSchema>;
export type AppDefinition = z.infer<typeof AppDefinitionSchema>;
export type ExecuteBody = z.infer<typeof ExecuteBodySchema>;
