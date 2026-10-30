import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const projects = await db.savedProject.findMany({
    select: { id: true, name: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name ?? 'Untitled circuit');
    const data = JSON.stringify(body.data ?? null);
    const existing = body.id;
    if (existing) {
      const updated = await db.savedProject.update({
        where: { id: existing }, data: { name, data },
      });
      return NextResponse.json(updated);
    }
    const created = await db.savedProject.create({ data: { name, data } });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
