import { notFound } from "next/navigation";
import { isValidAdminKey } from "@/lib/admin/auth";
import { listOwnerBookings, type CalBooking } from "@/lib/admin/cal";
import AdminInbox from "./admin-inbox";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Booking Inbox — Victoria Vasilyeva Holistic Beauty",
  robots: { index: false, follow: false },
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { key } = await searchParams;
  const adminKey = typeof key === "string" ? key : undefined;
  if (!isValidAdminKey(adminKey)) notFound();

  let bookings: CalBooking[] = [];
  let loadError: string | null = null;
  try {
    bookings = await listOwnerBookings();
  } catch (error) {
    console.error("Admin inbox load error:", error);
    loadError = "Couldn't load bookings from Cal.com. Pull down to refresh or try again shortly.";
  }

  const now = Date.now();
  const pending = bookings.filter((b) => b.status === "pending");
  const confirmed = bookings.filter(
    (b) => b.status === "accepted" && new Date(b.start).getTime() > now
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#847866]">
          Victoria Vasilyeva Holistic Beauty
        </p>
        <h1 className="mt-2 font-serif text-4xl text-[#3A332C]">Booking inbox</h1>
        <p className="mt-2 text-sm text-[#847866]">
          Times shown in Cairo time (Africa/Cairo).
        </p>
      </header>

      {loadError ? (
        <div className="rounded-2xl border border-[#B5483A]/30 bg-[#FFFDF9] px-6 py-5 text-sm text-[#B5483A]">
          {loadError}
        </div>
      ) : (
        <AdminInbox pending={pending} confirmed={confirmed} adminKey={adminKey!} />
      )}
    </main>
  );
}
