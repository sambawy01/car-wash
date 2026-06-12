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
    const body: Record<string, unknown> = { error: result.error };
    if (result.details !== undefined) body.details = result.details;
    if (result.error === 'Failed to fetch available slots from Cal.com') {
      body.status = result.status;
    }
    return NextResponse.json(body, { status: result.status });
  }

  // Return the slot map directly: { "2026-06-17": [{ "start": "…" }] }
  return NextResponse.json(result.data);
}
