import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { isValidAdminKey, isValidBasicAuth } from "@/lib/admin/auth";
import { listOwnerBookings, type CalBooking } from "@/lib/admin/cal";
import { listOrders, type StoredOrder } from "@/lib/orders";
import { getCatalog, type Product } from "@/lib/catalog";
import { getTreatmentsCatalog, type Treatment } from "@/lib/treatments";
import { buildPnL, resolvePeriod, type PnL } from "@/lib/finance-report";
import {
  getClientsOverview,
  toClientSummary,
  type ClientSummary,
  type RebookingClient,
  type UnlinkedOverlay,
} from "@/lib/crm";
import AdminInbox from "./admin-inbox";
import AdminTabs from "./admin-tabs";
import OrdersSection from "./orders-section";
import ProductsSection from "./products-section";
import TreatmentsSection from "./treatments-section";
import FinanceSection from "./finance-section";
import ClientsSection from "./clients-section";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin — Elite Eco Car Wash",
  robots: { index: false, follow: false },
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Auth happens in the proxy (which answers 401 + WWW-Authenticate so the
  // browser shows its native Basic login prompt). This re-check is defense
  // in depth: Basic credentials OR the legacy ?key= link from old emails.
  const { key } = await searchParams;
  const legacyKey =
    typeof key === "string" && isValidAdminKey(key) ? key : "";
  const requestHeaders = await headers();
  const basicOk = isValidBasicAuth(requestHeaders.get("authorization"));
  if (!basicOk && !legacyKey) notFound();

  // When authenticated via Basic, the browser re-attaches the Authorization
  // header to every same-origin fetch, so client components can send an
  // empty x-admin-key — the API routes accept either credential.
  const clientKey = legacyKey;

  let bookings: CalBooking[] = [];
  let loadError: string | null = null;
  let orders: StoredOrder[] = [];
  let ordersError: string | null = null;
  let products: Product[] = [];
  let productsError: string | null = null;
  let treatments: Treatment[] = [];
  let treatmentsError: string | null = null;
  let financePnl: PnL | null = null;
  let financeError: string | null = null;
  let clientSummaries: ClientSummary[] = [];
  let rebooking: RebookingClient[] = [];
  let unlinkedOverlays: UnlinkedOverlay[] = [];
  let clientsError: string | null = null;
  const monthPeriod = resolvePeriod({ period: "month" });
  // Bookings (Cal.com), shop orders, the two catalogs and the finance P&L
  // (Vercel Blob + Cal) load independently — one backend being down must not
  // blank the others.
  const [
    bookingsResult,
    ordersResult,
    catalogResult,
    treatmentsResult,
    financeResult,
    clientsResult,
  ] = await Promise.allSettled([
    listOwnerBookings(),
    listOrders({ limit: 100 }),
    getCatalog(),
    getTreatmentsCatalog(),
    monthPeriod.ok ? buildPnL(monthPeriod.period) : Promise.reject(new Error("bad period")),
    getClientsOverview({ weeks: 6 }),
  ]);
  if (bookingsResult.status === "fulfilled") {
    bookings = bookingsResult.value;
  } else {
    console.error("Admin inbox load error:", bookingsResult.reason);
    loadError = "Couldn't load bookings from Cal.com. Pull down to refresh or try again shortly.";
  }
  if (ordersResult.status === "fulfilled") {
    orders = ordersResult.value;
  } else {
    console.error("Admin orders load error:", ordersResult.reason);
    ordersError = "Couldn't load shop orders. Pull down to refresh or try again shortly.";
  }
  if (catalogResult.status === "fulfilled") {
    products = catalogResult.value;
  } else {
    console.error("Admin catalog load error:", catalogResult.reason);
    productsError = "Couldn't load the product catalog. Pull down to refresh or try again shortly.";
  }
  if (treatmentsResult.status === "fulfilled") {
    treatments = treatmentsResult.value;
  } else {
    console.error("Admin treatments load error:", treatmentsResult.reason);
    treatmentsError = "Couldn't load the treatments. Pull down to refresh or try again shortly.";
  }
  if (financeResult.status === "fulfilled") {
    financePnl = financeResult.value;
  } else {
    console.error("Admin finance load error:", financeResult.reason);
    financeError = "Couldn't load the finance ledger. Pull down to refresh or try again shortly.";
  }
  if (clientsResult.status === "fulfilled") {
    clientSummaries = clientsResult.value.profiles.map(toClientSummary);
    rebooking = clientsResult.value.rebooking;
    unlinkedOverlays = clientsResult.value.unlinked;
  } else {
    console.error("Admin clients load error:", clientsResult.reason);
    clientsError = "Couldn't load clients. Pull down to refresh or try again shortly.";
  }

  const now = Date.now();
  const pending = bookings.filter((b) => b.status === "pending");
  const confirmed = bookings.filter(
    (b) => b.status === "accepted" && new Date(b.start).getTime() > now
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#4A5568]">
          Elite Eco Car Wash
        </p>
        <h1 className="mt-2 font-serif text-4xl text-[#0A1A2F]">Car wash admin</h1>
        <p className="mt-2 text-sm text-[#4A5568]">
          Times shown in Cairo time (Africa/Cairo).
        </p>
      </header>

      <AdminTabs
        pendingBookings={pending.length}
        rebookingDue={rebooking.length}
        bookings={
          loadError ? (
            <div className="rounded-2xl border border-[#B91C1C]/30 bg-[#FFFFFF] px-6 py-5 text-sm text-[#B91C1C]">
              {loadError}
            </div>
          ) : (
            <AdminInbox
              pending={pending}
              confirmed={confirmed}
              adminKey={clientKey}
            />
          )
        }
        orders={
          <OrdersSection
            orders={orders}
            adminKey={clientKey}
            loadError={ordersError}
          />
        }
        products={
          <ProductsSection
            initialProducts={products}
            adminKey={clientKey}
            loadError={productsError}
          />
        }
        treatments={
          <TreatmentsSection
            initialTreatments={treatments}
            adminKey={clientKey}
            loadError={treatmentsError}
          />
        }
        finance={
          <FinanceSection
            initialPnl={financePnl}
            adminKey={clientKey}
            loadError={financeError}
          />
        }
        clients={
          <ClientsSection
            initialClients={clientSummaries}
            initialRebooking={rebooking}
            initialUnlinked={unlinkedOverlays}
            adminKey={clientKey}
            loadError={clientsError}
          />
        }
      />
    </main>
  );
}
