import { NextRequest, NextResponse } from "next/server";
import { isValidAdminKey } from "@/lib/admin/auth";
import { confirmBooking } from "@/lib/admin/cal";

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

  try {
    const result = await confirmBooking(uid);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Admin confirm error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
