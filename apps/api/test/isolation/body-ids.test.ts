// How the isolation suite reads a body's record ids from its zod schema (body-ids.ts).
import { Body, Controller, Post } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from '../../src/common/zod-validation.pipe.js';
import { bodyIdFields, idFields } from './body-ids.js';

const paths = (schema: z.ZodType) => idFields(schema).map((f) => `${f.path}${f.list ? '[]' : ''}`);

describe('body ids (isolation suite)', () => {
  it('finds ids by name and by uuid format, through wrappers and refinements', () => {
    const schema = z
      .strictObject({
        clientId: z.uuid(),
        ids: z.array(z.uuid()).min(1),
        staffUserIds: z.array(z.string()).optional(),
        owner: z.string().uuid().nullable(),
        title: z.string(),
        when: z.iso.datetime(),
      })
      .refine(() => true)
      .transform((b) => b);
    expect(paths(schema)).toEqual(['clientId', 'ids[]', 'staffUserIds[]', 'owner']);
    expect(paths(z.preprocess((v) => v ?? {}, z.object({ typeId: z.guid().catch('') })))).toEqual([
      'typeId',
    ]);
  });

  it('looks inside intersections, unions, lazy, tuples, records and nested objects', () => {
    const a = z.object({ clientId: z.uuid() });
    const b = z.object({ engagementId: z.uuid().nonoptional() });
    expect(paths(a.and(b))).toEqual(['clientId', 'engagementId']);
    expect(paths(z.union([a, b]))).toEqual(['clientId', 'engagementId']);
    expect(paths(z.lazy(() => a))).toEqual(['clientId']);
    expect(paths(z.object({ pair: z.tuple([a], b) }))).toEqual([
      'pair.clientId',
      'pair.engagementId',
    ]);
    expect(paths(z.object({ byKey: z.record(z.string(), a) }))).toEqual(['byKey.*.clientId']);
    expect(paths(z.object({ items: z.array(a) }))).toEqual(['items.clientId']);
    expect(paths(z.object({ extra: z.string() }).catchall(a))).toEqual(['*.clientId']);
  });

  it('finds a uuid wherever it sits, not only as an object field', () => {
    expect(paths(z.object({ owner: z.uuid().or(z.literal('')) }))).toEqual(['owner']);
    expect(paths(z.object({ owner: z.uuid().or(z.null()) }))).toEqual(['owner']);
    expect(paths(z.object({ assign: z.record(z.string(), z.uuid()) }))).toEqual(['assign.*']);
    expect(paths(z.object({}).catchall(z.uuid()))).toEqual(['*']);
    expect(paths(z.object({ pair: z.tuple([z.uuid(), z.uuid()]) }))).toEqual(['pair']);
    expect(paths(z.object({ who: z.lazy(() => z.uuid()) }))).toEqual(['who']);
    expect(paths(z.object({ grid: z.array(z.array(z.uuid())) }))).toEqual(['grid[]']);
    expect(paths(z.object({ who: z.uuid().and(z.string()) }))).toEqual(['who']);
  });

  it('reads the shape behind a custom check, and still throws on a bare custom', () => {
    const isObject = (v: unknown) => typeof v === 'object' && v !== null;
    const answers = z
      .custom<object>(isObject)
      .pipe(z.record(z.string(), z.object({ clientId: z.uuid() })));
    expect(paths(answers)).toEqual(['*.clientId']);
    expect(() => idFields(z.object({ m: z.custom() }))).toThrow(/cannot read zod type custom/);
  });

  it('throws on a type it cannot look inside', () => {
    const unreadable = [
      z.object({ x: z.any() }),
      z.unknown(),
      z.custom(),
      z.map(z.string(), z.string()),
    ];
    for (const schema of unreadable) expect(() => idFields(schema)).toThrow(/cannot read zod type/);
    expect(() => idFields({})).toThrow(/cannot read zod type/);
  });

  it('reports a body it has no zod schema for, and takes a bare @Body() next to one', () => {
    class Pipe {
      transform(v: unknown) {
        return v;
      }
    }
    @Controller('x')
    class C {
      @Post('bare')
      bare(@Body() _b: object) {}
      @Post('named')
      named(@Body('clientId', new ZodValidationPipe(z.uuid())) _b: string) {}
      @Post('other')
      other(@Body(new Pipe()) _b: object) {}
      @Post('both')
      both(
        @Body(new ZodValidationPipe(z.object({ clientId: z.uuid() }))) _a: object,
        @Body() _b: object,
      ) {}
      @Post('none')
      none() {}
    }
    const read = (name: string) => bodyIdFields(C, name, `POST /x/${name}`);
    for (const name of ['bare', 'named', 'other']) expect(read(name).unreadable).toBeDefined();
    expect(read('both')).toEqual({ fields: [{ path: 'clientId', list: false }] });
    expect(read('none')).toEqual({ fields: [] });
  });

  it('leaves out the uuids NOT_RECORDS names, on their routes only', () => {
    @Controller('business/clients')
    class C {
      @Post(':id/message-threads')
      create(
        @Body(new ZodValidationPipe(z.object({ related: z.object({ id: z.uuid() }) }))) _b: object,
      ) {}
    }
    const key = 'POST /api/v1/business/clients/:id/message-threads';
    expect(bodyIdFields(C, 'create', key).fields).toEqual([]);
    expect(bodyIdFields(C, 'create', 'POST /api/v1/other').fields).toEqual([
      { path: 'related.id', list: false },
    ]);
  });
});
