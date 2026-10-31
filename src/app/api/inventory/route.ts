import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { parsePartNumber } from '@/lib/logibench/partNumber';

/** Trust boundary: the inventory POST body. Unknown keys are stripped. */
const createSchema = z.object({
  partNumber: z.string().trim().min(1).max(64),
  package: z.string().max(64).default(''),
  qty: z.coerce.number().int().min(0).max(100_000).default(1),
  condition: z.string().max(64).default('new'),
  location: z.string().max(128).nullish(),
  notes: z.string().max(2000).nullish(),
});

/** 500s must not echo Prisma/engine messages to the client. */
function fail(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  console.error('[api/inventory]', e);
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 64);
    const items = await db.inventoryItem.findMany({
      // personal parts bin — full list by default; cap as a safety ceiling
      take: 500,
      where: q
        ? {
            OR: [
              { partNumber: { contains: q } },
              { location: { contains: q } },
              { notes: { contains: q } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(items);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const pn = parsePartNumber(body.partNumber);
    const item = await db.inventoryItem.create({
      data: {
        partNumber: body.partNumber,
        base: pn.base,
        family: pn.family,
        package: body.package,
        qty: body.qty,
        condition: body.condition,
        location: body.location ?? null,
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
