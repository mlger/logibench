import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';

/** Trust boundary: save body. `data` is the opaque project JSON (schema v2). */
const saveSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().max(200).optional(),
  data: z.unknown(),
});

function fail(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  console.error('[api/projects]', e);
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}

export async function GET() {
  try {
    const projects = await db.savedProject.findMany({
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json(projects);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = saveSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const name = body.name?.trim() || 'Untitled circuit';
    const data = JSON.stringify(body.data ?? null);
    if (body.id) {
      const updated = await db.savedProject.update({
        where: { id: body.id },
        data: { name, data },
      });
      return NextResponse.json(updated);
    }
    const created = await db.savedProject.create({ data: { name, data } });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
