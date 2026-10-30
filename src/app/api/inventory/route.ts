import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parsePartNumber } from '@/lib/logibench/partNumber';

export async function GET() {
  const items = await db.inventoryItem.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const partNumber = String(body.partNumber ?? '').trim();
    if (!partNumber) {
      return NextResponse.json({ error: 'partNumber is required' }, { status: 400 });
    }
    const parsed = parsePartNumber(partNumber);
    const item = await db.inventoryItem.create({
      data: {
        partNumber,
        base: parsed.base,
        family: parsed.family,
        package: String(body.package ?? ''),
        qty: Number(body.qty ?? 1),
        condition: String(body.condition ?? 'new'),
        location: body.location ?? null,
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
