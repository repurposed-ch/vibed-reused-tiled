import { describe, expect, it } from 'vitest';
import { createTileDefinition } from '@/domain/tile';
import { assistTileSchemaWith } from '@/llm/assist';

const large = createTileDefinition({ id: 'a', name: 'Large', length: 0.44, width: 0.44 });
const unit = createTileDefinition({ id: 'b', name: 'Unit', length: 0.14, width: 0.14 });

/** A reply that forgets the joint header — the parse must still use the requested joint. */
const REPLY = `cell 0.15
u 4,0
v 0,4
b b b b
a a a b
a a a b
a a a b`;

describe('assist with a joint', () => {
  it('sets the cell to tile + joint, tells the model, and keeps the joint on parse', async () => {
    const prompts: string[] = [];
    const result = await assistTileSchemaWith(
      async (prompt) => {
        prompts.push(prompt);
        return REPLY;
      },
      { request: { prompt: 'a bond', tileDefinitions: [large, unit], joint: 0.01 } },
    );

    expect(prompts[0]).toContain('joint 0.01');
    expect(prompts[0]).toMatch(/cell 0\.15\b/);
    expect(prompts[0]).not.toContain('0.15000000000000002');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.tileGrids[0]!.joint).toBeCloseTo(0.01, 9);
  });
});
