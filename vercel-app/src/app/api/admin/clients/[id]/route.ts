import { NextRequest, NextResponse } from "next/server";
import {
  isAuthorizedAdminRequest,
  unauthorizedResponse,
} from "@/lib/admin/auth";
import {
  deleteClientRecords,
  getClientProfile,
  isValidClientId,
} from "@/lib/crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/clients/<id> — one client's full profile: booking history,
 * order history, derived stats, plus the stored overlay (notes + tags).
 *
 * Admin-only PII. Auth re-checked (defense in depth).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedAdminRequest(request)) return unauthorizedResponse();

  const { id } = await params;
  if (!isValidClientId(id)) {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
  }

  try {
    const profile = await getClientProfile(id);
    if (!profile) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json({ client: profile });
  } catch (error) {
    console.error(`[admin/clients] Profile load failed (${id}):`, error);
    return NextResponse.json(
      { error: "Couldn't load the client. Please try again." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/clients/<id> — right-to-erasure for the studio's INTERNAL
 * records: removes every private note blob + the tag overlay for this client.
 * (Booking/order history lives in Cal / the orders store and is governed
 * separately — see the privacy policy.) Also the cleanup path for an orphaned
 * overlay, so it never requires a resolvable profile. Admin-only; auth
 * re-checked (defense in depth).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorizedAdminRequest(request)) return unauthorizedResponse();

  const { id } = await params;
  if (!isValidClientId(id)) {
    return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
  }

  try {
    const { removed } = await deleteClientRecords(id);
    return NextResponse.json({ ok: true, id, removed });
  } catch (error) {
    console.error(`[admin/clients] Erasure failed (${id}):`, error);
    return NextResponse.json(
      { error: "Couldn't delete the client's records. Please try again." },
      { status: 500 }
    );
  }
}
