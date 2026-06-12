"use client";

import { useState, type ReactNode } from "react";

/**
 * Client-side tab switcher for /admin: Bookings | Orders | Products |
 * Treatments. The server page renders every section once and passes them in
 * as nodes; switching tabs only toggles visibility (hidden sections keep
 * their client state — drafts, inline edits — intact).
 */

export type AdminTabId = "bookings" | "orders" | "products" | "treatments";

interface TabDef {
  id: AdminTabId;
  label: string;
  /** Small count badge (e.g. pending bookings). Omitted when 0/undefined. */
  badge?: number;
}

export default function AdminTabs({
  pendingBookings,
  bookings,
  orders,
  products,
  treatments,
}: {
  pendingBookings: number;
  bookings: ReactNode;
  orders: ReactNode;
  products: ReactNode;
  treatments: ReactNode;
}) {
  const [active, setActive] = useState<AdminTabId>("bookings");

  const tabs: TabDef[] = [
    { id: "bookings", label: "Bookings", badge: pendingBookings },
    { id: "orders", label: "Orders" },
    { id: "products", label: "Products" },
    { id: "treatments", label: "Treatments" },
  ];

  const panels: Record<AdminTabId, ReactNode> = {
    bookings,
    orders,
    products,
    treatments,
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Admin sections"
        className="mb-8 flex flex-wrap gap-2 border-b border-[#3A332C]/10 pb-3"
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
                  ? "rounded-full bg-[#8A5238] px-4 py-2 text-sm font-medium text-[#FDF9F3]"
                  : "rounded-full border border-[#3A332C]/15 bg-[#FFFDF9] px-4 py-2 text-sm font-medium text-[#3A332C] transition-colors hover:bg-[#F4EFE7]"
              }
            >
              {tab.label}
              {tab.badge ? (
                <span
                  className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    selected
                      ? "bg-[#FDF9F3]/20 text-[#FDF9F3]"
                      : "bg-[#B5483A]/15 text-[#B5483A]"
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
