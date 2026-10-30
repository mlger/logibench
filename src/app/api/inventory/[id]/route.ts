import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parsePartNumber } from '@/lib/logibench/partNumber';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.partNumber !== undefined) {
      const parsed = parsePartNumber(String(body.partNumber));
      data.partNumber = String(body.partNumber);
      data.base = parsed.base;
      data.family = parsed.family;
    }
    for (const k of ['package', 'condition', 'location', 'notes'] as const) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.qty !== undefined) data.qty = Number(body.qty);
    const item = await db.inventoryItem.update({ where: { id }, data });
    return NextResponse.json(item);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
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
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
