import { describe, expect, it } from 'vitest';
import { createTileDefinition } from '@/domain/tile';
import { assistTileSchemaWith } from '@/llm/assist';

const CELL = 0.15;
const large = createTileDefinition({ id: 'a', name: 'Large', length: CELL * 3, width: CELL * 3 });
const unit = createTileDefinition({ id: 'b', name: 'Unit', length: CELL, width: CELL });
const tileDefinitions = [large, unit];

const GOOD = `cell 0.15
u 4,0
v 0,4
b b b b
a a a b
a a a b
a a a b`;

/** A reply the parser cannot use: the a block is drawn 2×2 but a is 3×3 cells. */
const BAD = `cell 0.15
u 2,0
v 0,2
a a
a a`;

function transport(replies: string[]) {
  const prompts: string[] = [];
  const call = async (prompt: string) => {
    prompts.push(prompt);
    return replies[prompts.length - 1] ?? replies[replies.length - 1]!;
  };
  return { call, prompts };
}

describe('assistTileSchemaWith', () => {
  it('makes one call when the first reply parses', async () => {
    const { call, prompts } = transport([GOOD]);
    const result = await assistTileSchemaWith(call, { request: { prompt: 'anything', tileDefinitions } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(prompts).toHaveLength(1);
    expect(result.schema.tileGrids[0]!.extent).toEqual({ iCount: 4, jCount: 4 });
  });

  it('repairs once, feeding the parse error back', async () => {
    const { call, prompts } = transport([BAD, GOOD]);
    const result = await assistTileSchemaWith(call, { request: { prompt: 'anything', tileDefinitions } });

    expect(result.ok).toBe(true);
    expect(prompts).toHaveLength(2);
    // The follow-up has to carry both the failure and the reply it came from,
    // otherwise the model has nothing to correct.
    expect(prompts[1]).toContain('could not be read');
    expect(prompts[1]).toContain('a a');
  });

  it('stops after one repair rather than looping', async () => {
    const { call, prompts } = transport([BAD, BAD, GOOD]);
    const result = await assistTileSchemaWith(call, { request: { prompt: 'anything', tileDefinitions } });

    expect(prompts).toHaveLength(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The raw reply survives so the page can offer it for hand-correction.
    expect(result.notation).toContain('a a');
    expect(result.error).toMatch(/runs off the grid/);
  });

  it('keeps a transport failure in the same shape', async () => {
    const call = async () => {
      throw new Error('LLM assist failed (429): rate limited');
    };
    const result = await assistTileSchemaWith(call, { request: { prompt: 'x', tileDefinitions } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/429/);
    expect(result.notation).toBe('');
  });

  it('refuses without a tile catalogue instead of calling out', async () => {
    const { call, prompts } = transport([GOOD]);
    const result = await assistTileSchemaWith(call, { request: { prompt: 'x', tileDefinitions: [] } });

    expect(prompts).toHaveLength(0);
    expect(result.ok).toBe(false);
  });

  it('recovers when the model restates an example before answering', async () => {
    // The failure the user reported: a one-cell example echoed, then the answer.
    const echoed = `cell 0.15\nu 1,0\nv 0,1\nb\n${GOOD}`;
    const { call, prompts } = transport([echoed]);
    const result = await assistTileSchemaWith(call, { request: { prompt: 'x', tileDefinitions } });

    expect(prompts).toHaveLength(1); // no repair needed
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema.tileGrids[0]!.extent).toEqual({ iCount: 4, jCount: 4 });
  });

  it('never sends a baked texture', async () => {
    const heavy = { ...unit, texture: `data:image/png;base64,${'A'.repeat(50_000)}` };
    const { call, prompts } = transport([GOOD]);
    await assistTileSchemaWith(call, {
      request: { prompt: 'x', tileDefinitions: [large, heavy].map((t) => ({ ...t, texture: undefined })) },
    });
    expect(prompts[0]).not.toContain('data:image');
    expect(prompts[0]!.length).toBeLessThan(4000);
  });

  it('does not offer a one-cell grid as a worked example', async () => {
    // Its single-letter row is what collides with the next block's header when a
    // model echoes it, and it demonstrates nothing.
    const { call, prompts } = transport([GOOD]);
    await assistTileSchemaWith(call, { request: { prompt: 'x', tileDefinitions } });
    const examples = prompts[0]!.split('Worked examples:')[1] ?? '';
    expect(examples).not.toMatch(/^b$/m);
  });
});
