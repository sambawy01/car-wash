import { NextRequest, NextResponse } from "next/server";
import { isValidAdminKey } from "@/lib/admin/auth";
import { declineBooking } from "@/lib/admin/cal";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  if (!isValidAdminKey(request.headers.get("x-admin-key"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { uid } = await params;
  if (!uid) {
    return NextResponse.json({ error: "Missing booking uid" }, { status: 400 });
  }

  let reason: unknown;
  try {
    const body = await request.json();
    reason = body?.reason;
  } catch {
    // fall through to validation below
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return NextResponse.json(
      { error: "A note for the client is required to decline" },
      { status: 400 }
    );
  }

  try {
    const result = await declineBooking(uid, reason.trim());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Admin decline error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
