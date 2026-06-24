"use client";

import { useState, type ReactNode } from "react";

/**
 * Client-side tab switcher for /admin: Bookings | Orders | Products |
 * Treatments | Finance | Clients. The server page renders every section once
 * and passes them in as nodes; switching tabs only toggles visibility (hidden
 * sections keep their client state — drafts, inline edits — intact).
 */

export type AdminTabId =
  | "bookings"
  | "orders"
  | "products"
  | "treatments"
  | "finance"
  | "clients";

interface TabDef {
  id: AdminTabId;
  label: string;
  /** Small count badge (e.g. pending bookings). Omitted when 0/undefined. */
  badge?: number;
}

export default function AdminTabs({
  pendingBookings,
  rebookingDue,
  bookings,
  orders,
  products,
  treatments,
  finance,
  clients,
}: {
  pendingBookings: number;
  rebookingDue: number;
  bookings: ReactNode;
  orders: ReactNode;
  products: ReactNode;
  treatments: ReactNode;
  finance: ReactNode;
  clients: ReactNode;
}) {
  const [active, setActive] = useState<AdminTabId>("bookings");

  const tabs: TabDef[] = [
    { id: "bookings", label: "Bookings", badge: pendingBookings },
    { id: "orders", label: "Orders" },
    { id: "products", label: "Products" },
    { id: "treatments", label: "Treatments" },
    { id: "finance", label: "Finance" },
    { id: "clients", label: "Clients", badge: rebookingDue },
  ];

  const panels: Record<AdminTabId, ReactNode> = {
    bookings,
    orders,
    products,
    treatments,
    finance,
    clients,
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Admin sections"
        className="mb-8 flex flex-wrap gap-2 border-b border-[#0A1A2F]/10 pb-3"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`admin-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`admin-panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={
                selected
                  ? "rounded-full bg-[#1A5F9E] px-4 py-2 text-sm font-medium text-[#F8FAFC]"
                  : "rounded-full border border-[#0A1A2F]/15 bg-[#FFFFFF] px-4 py-2 text-sm font-medium text-[#0A1A2F] transition-colors hover:bg-[#F8FAFC]"
              }
            >
              {tab.label}
              {tab.badge ? (
                <span
                  className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    selected
                      ? "bg-[#F8FAFC]/20 text-[#F8FAFC]"
                      : "bg-[#B91C1C]/15 text-[#B91C1C]"
                  }`}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`admin-panel-${tab.id}`}
          aria-labelledby={`admin-tab-${tab.id}`}
          hidden={tab.id !== active}
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}
