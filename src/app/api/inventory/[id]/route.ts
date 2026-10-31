import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { parsePartNumber } from '@/lib/logibench/partNumber';

/** Trust boundary: PATCH body — every field optional, all lengths capped. */
const patchSchema = z.object({
  partNumber: z.string().trim().min(1).max(64).optional(),
  package: z.string().max(64).optional(),
  qty: z.coerce.number().int().min(0).max(100_000).optional(),
  condition: z.string().max(64).optional(),
  location: z.string().max(128).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function fail(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  console.error('[api/inventory/:id]', e);
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const data: Record<string, unknown> = {};
    if (body.partNumber !== undefined) {
      const pn = parsePartNumber(body.partNumber);
      data.partNumber = body.partNumber;
      data.base = pn.base;
      data.family = pn.family;
    }
    if (body.package !== undefined) data.package = body.package;
    if (body.condition !== undefined) data.condition = body.condition;
    if (body.location !== undefined) data.location = body.location;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.qty !== undefined) data.qty = body.qty;
    const item = await db.inventoryItem.update({ where: { id }, data });
    return NextResponse.json(item);
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await db.inventoryItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
