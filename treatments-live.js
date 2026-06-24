/* Live services menu — progressive enhancement over the server-rendered
   service rows on index.html / ar.html.

   Fetches GET <API_BASE>/api/treatments (admin edits prices, durations,
   names and visibility from /admin) and reconciles the static rows in place:
   - a row whose service no longer exists or was deactivated is hidden;
   - a row whose name/duration/price differs from the EMBEDDED seed below is
     rewritten with the live values (rows still matching the seed keep their
     richer server-rendered text, e.g. multi-duration price ranges);
   - services that have no row yet are appended to the first list, with the
     same markup (t-link to /book?service=slug, lang preserved).

   If this script or the fetch fails, the server-rendered rows stay as-is —
   exactly like shop.js's embedded-fallback pattern. */
(function () {
  "use strict";

  var IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var API_BASE = IS_LOCAL
    ? "http://localhost:3000"
    : "https://book.eliteecocarwash.com";
  var TREATMENTS_URL = API_BASE + "/api/treatments";
  var BOOK_BASE = "https://book.eliteecocarwash.com/book";

  /* ===================================================================
     EMBEDDED SEED — mirrors SEED in vercel-app/src/lib/treatments.ts.
     Used only for change detection: while the API returns these exact
     values for a slug, its server-rendered row is left untouched.
     n = canonical names (EN/AR), d = minutes, e = EGP.
     =================================================================== */
  var SEED = {
    "interior-exterior-wash": { n: { en: "Interior & Exterior Wash", ar: "غسيل داخلي وخارجي" }, d: 75, e: 370 },
    "wheel-cleaning": { n: { en: "Wheel Cleaning", ar: "تنظيف الجنوط" }, d: 30, e: 140 },
    "engine-cleaning": { n: { en: "Engine Cleaning", ar: "تنظيف المحرك" }, d: 30, e: 230 },
    "polishing-protection": { n: { en: "Polishing & Protection", ar: "تلميع وحماية الطلاء" }, d: 90, e: 700 },
    "steam-cleaning": { n: { en: "Steam Cleaning", ar: "تنظيف وتعقيم بالبخار" }, d: 60, e: 330 },
    "waterless-wash": { n: { en: "Waterless Wash", ar: "غسيل بدون مياه" }, d: 45, e: 220 }
  };
  /* ========================= end SEED ================================ */

  var LANG = (document.documentElement.lang || "en").toLowerCase().indexOf("ar") === 0 ? "ar" : "en";

  /* "E£370" — price format with comma thousands. */
  function formatEgp(n) {
    return "E£" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* Render the .t-price contents: "E£370 <small>75m</small>" /
     "E£370 <small>75 دقيقة</small>" — copied from the existing rows. */
  function renderPrice(priceEl, t) {
    while (priceEl.firstChild) priceEl.removeChild(priceEl.firstChild);
    priceEl.appendChild(
      document.createTextNode(formatEgp(t.priceEgp) + " ")
    );
    var small = document.createElement("small");
    small.textContent =
      LANG === "ar" ? t.durationMinutes + " دقيقة" : t.durationMinutes + "m";
    priceEl.appendChild(small);
  }

  function slugFromLink(a) {
    try {
      return new URL(a.href).searchParams.get("service");
    } catch (_) {
      return null;
    }
  }

  /* Find the static row for a slug (or null). */
  function findRow(slug) {
    var links = document.querySelectorAll(".t-link");
    for (var i = 0; i < links.length; i++) {
      if (slugFromLink(links[i]) === slug) return links[i].closest(".t-row");
    }
    return null;
  }

  /* Rewrite a row's name, price and link with the live values. */
  function rewriteRow(row, t) {
    var link = row.querySelector(".t-link");
    if (!link) return;
    link.textContent = t.name[LANG];
    link.href = BOOK_BASE + "?service=" + t.slug + (LANG === "ar" ? "&lang=ar" : "");

    var sub = row.querySelector(".t-sub");
    if (sub) sub.textContent = t.description[LANG] || "";

    var price = row.querySelector(".t-price");
    if (price) renderPrice(price, t);
  }

  /* Append a new row for a service not in the static markup. */
  function appendRow(t, list) {
    var li = document.createElement("li");
    li.className = "t-row";
    var name = document.createElement("span");
    name.className = "t-name";
    var link = document.createElement("a");
    link.className = "t-link";
    link.href = BOOK_BASE + "?service=" + t.slug + (LANG === "ar" ? "&lang=ar" : "");
    link.textContent = t.name[LANG];
    name.appendChild(link);
    if (t.description[LANG]) {
      var sub = document.createElement("span");
      sub.className = "t-sub";
      sub.textContent = t.description[LANG];
      name.appendChild(sub);
    }
    var price = document.createElement("span");
    price.className = "t-price";
    renderPrice(price, t);
    var arrow = document.createElement("span");
    arrow.className = "t-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    li.append(name, price, arrow);
    list.appendChild(li);
  }

  /* ---- Main: fetch live treatments and reconcile ---- */
  var firstList = document.querySelector(".t-list");
  if (!firstList) return; // no treatments section on this page

  fetch(TREATMENTS_URL, { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
    .then(function (treatments) {
      if (!Array.isArray(treatments)) return;

      // Hide rows whose treatment is inactive or missing from the API.
      var staticRows = document.querySelectorAll(".t-row");
      staticRows.forEach(function (row) {
        var link = row.querySelector(".t-link");
        if (!link) return;
        var slug = slugFromLink(link);
        if (!slug) return;
        var match = treatments.find(function (t) { return t.slug === slug; });
        if (!match || match.active === false) {
          row.style.display = "none";
        }
      });

      // Rewrite rows whose values differ from the seed.
      treatments.forEach(function (t) {
        if (t.active === false) return;
        var seed = SEED[t.slug];
        var row = findRow(t.slug);
        if (!row) {
          // Service not in static markup — append it.
          appendRow(t, firstList);
          return;
        }
        if (!seed) {
          // New service not in seed — always rewrite.
          rewriteRow(row, t);
          return;
        }
        var changed =
          seed.n[LANG] !== t.name[LANG] ||
          seed.d !== t.durationMinutes ||
          seed.e !== t.priceEgp;
        if (changed) rewriteRow(row, t);
      });
    })
    .catch(function (err) {
      // Network/API failure — static rows stay as-is.
      if (typeof console !== "undefined") console.warn("[treatments-live] " + err.message);
    });
})();