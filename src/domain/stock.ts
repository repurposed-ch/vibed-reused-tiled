import { z } from 'zod';

export const StockEntryExactJsonSchema = z.object({
  tileDefinitionId: z.string().min(1),
  kind: z.literal('exact'),
  count: z.number().int().nonnegative(),
});

export const StockEntryDistributionJsonSchema = z.object({
  tileDefinitionId: z.string().min(1),
  kind: z.literal('distribution'),
  distribution: z.enum(['poisson', 'normal', 'uniform']),
  params: z.record(z.string(), z.number()),
});

export const StockEntryJsonSchema = z.discriminatedUnion('kind', [
  StockEntryExactJsonSchema,
  StockEntryDistributionJsonSchema,
]);

export const StockStateJsonSchema = z.object({
  type: z.literal('StockState'),
  entries: z.array(StockEntryJsonSchema),
});

export type StockEntryExactJson = z.infer<typeof StockEntryExactJsonSchema>;
export type StockEntryDistributionJson = z.infer<typeof StockEntryDistributionJsonSchema>;
export type StockEntryJson = z.infer<typeof StockEntryJsonSchema>;
export type StockStateJson = z.infer<typeof StockStateJsonSchema>;

export function emptyStock(): StockStateJson {
  return { type: 'StockState', entries: [] };
}
