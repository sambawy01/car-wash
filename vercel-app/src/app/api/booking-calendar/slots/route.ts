import { NextRequest, NextResponse } from 'next/server';
import { fetchCalSlots } from '@/lib/cal-slots';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const eventTypeId = searchParams.get('eventTypeId');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const duration = searchParams.get('duration');

  if (!eventTypeId || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: 'Missing required parameters: eventTypeId, dateFrom, dateTo' },
      { status: 400 }
    );
  }

  const result = await fetchCalSlots({ eventTypeId, dateFrom, dateTo, duration });

  if (!result.ok) {
    if (result.kind === 'config') {
      // Historical public contract — this exact body/status predates the
      // shared helper; keep it byte-identical for existing clients even
      // though the helper's internal message is more descriptive.
      return NextResponse.json(
        { error: 'Cal.com API key not configured' },
        { status: 500 }
      );
    }
    const body: Record<string, unknown> = { error: result.error };
    if (result.details !== undefined) body.details = result.details;
    // Only genuine upstream HTTP failures echo Cal's status in the body.
    if (result.kind === 'upstream') body.status = result.status;
    return NextResponse.json(body, { status: result.status });
  }

  // Return the slot map directly: { "2026-06-17": [{ "start": "…" }] }
  return NextResponse.json(result.data);
}
