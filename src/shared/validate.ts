import type { SafeCatalog, ValidationError } from "./catalog-types.js";
import { AppDefinitionSchema, type AppDefinition } from "./schema.js";

function schemaErrors(
  value: unknown,
  error: {
  issues: { path: PropertyKey[]; message: string }[];
  },
): ValidationError[] {
  const candidateBlocks =
    typeof value === "object" && value !== null && "blocks" in value
      ? (value as { blocks?: unknown }).blocks
      : undefined;
  return error.issues.map((issue) => {
    const blockIndex = issue.path[0] === "blocks" ? issue.path[1] : undefined;
    const path = issue.path.map(String).join(".");
    const block =
      typeof blockIndex === "number" && Array.isArray(candidateBlocks)
        ? candidateBlocks[blockIndex]
        : undefined;
    const blockId =
      typeof block === "object" && block !== null && "id" in block
        ? String((block as { id: unknown }).id)
        : undefined;
    return { path: path || "$", ...(blockId ? { blockId } : {}), message: issue.message };
  });
}

export function validateDefinition(
  value: unknown,
  catalog: SafeCatalog,
): { ok: true } | { ok: false; errors: ValidationError[] } {
  const parsed = AppDefinitionSchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: schemaErrors(value, parsed.error) };

  const definition: AppDefinition = parsed.data;
  const errors: ValidationError[] = [];
  const dataset = catalog.datasets.find(({ id }) => id === definition.datasetId);
  if (!dataset) {
    errors.push({
      path: "datasetId",
      message: `Unknown dataset: ${definition.datasetId}`,
    });
    return { ok: false, errors };
  }

  const blockIds = new Set<string>();
  for (const block of definition.blocks) {
    if (blockIds.has(block.id)) {
      errors.push({
        path: `blocks.${block.id}.id`,
        blockId: block.id,
        message: "Block IDs must be unique",
      });
    }
    blockIds.add(block.id);

    if (block.type === "record_table") {
      for (const field of block.config.columns) {
        if (!dataset.fields.some(({ key }) => key === field)) {
          errors.push({
            path: `blocks.${block.id}.config.columns`,
            blockId: block.id,
            message: `Unknown field: ${field}`,
          });
        }
      }
      if (
        block.config.defaultStatusFilter !== null &&
        !dataset.statusValues.includes(block.config.defaultStatusFilter)
      ) {
        errors.push({
          path: `blocks.${block.id}.config.defaultStatusFilter`,
          blockId: block.id,
          message: `Unknown status filter: ${block.config.defaultStatusFilter}`,
        });
      }
    }

    if (block.type === "record_details") {
      for (const field of block.config.fields) {
        if (!dataset.fields.some(({ key }) => key === field)) {
          errors.push({
            path: `blocks.${block.id}.config.fields`,
            blockId: block.id,
            message: `Unknown field: ${field}`,
          });
        }
      }
    }

    if (block.type === "action_button") {
      if (!dataset.actions.some(({ id }) => id === block.config.actionId)) {
        errors.push({
          path: `blocks.${block.id}.config.actionId`,
          blockId: block.id,
          message: `Action ${block.config.actionId} is not compatible with ${dataset.label}`,
        });
      }
    }

    if (
      block.type === "record_details" ||
      block.type === "action_button" ||
      block.type === "audit_history"
    ) {
      const source = definition.blocks.find(({ id }) => id === block.config.sourceTableId);
      if (!source || source.type !== "record_table") {
        errors.push({
          path: `blocks.${block.id}.config.sourceTableId`,
          blockId: block.id,
          message: "Source must reference a record table in this app",
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < definition.blocks.length; leftIndex += 1) {
    const left = definition.blocks[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < definition.blocks.length; rightIndex += 1) {
      const right = definition.blocks[rightIndex]!;
      const overlap =
        left.layout.x < right.layout.x + right.layout.w &&
        left.layout.x + left.layout.w > right.layout.x &&
        left.layout.y < right.layout.y + right.layout.h &&
        left.layout.y + left.layout.h > right.layout.y;
      if (overlap) {
        errors.push({
          path: `blocks.${right.id}.layout`,
          blockId: right.id,
          message: `Block overlaps ${left.id}`,
        });
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
