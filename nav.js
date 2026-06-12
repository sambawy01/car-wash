/* Earthen Calm — mobile navigation (vanilla JS, no dependencies).
   One file serves every page, same pattern as chat.js.

   On phones (≤ 700px) the inline nav links collapse behind a hamburger toggle;
   the bar keeps the logo and the Book Now / Записаться CTA. The menu panel is
   a full-width dropdown under the bar: card surface, gold hairline, serif list.

   Progressive enhancement: this script tags <html> with .has-navjs — every
   collapsed-state style in styles.css is gated behind that class, so without
   JS the original progressive link-hiding CSS keeps working untouched. */
(() => {
  "use strict";

  const nav = document.querySelector(".nav");
  const links = nav && nav.querySelector(".nav-links");
  if (!nav || !links) return;

  document.documentElement.classList.add("has-navjs");

  const RU = document.documentElement.lang === "ru";
  const T = RU
    ? { open: "Открыть меню", close: "Закрыть меню" }
    : { open: "Open menu", close: "Close menu" };

  /* ---- Restructure the bar: brand | [ links · CTA · toggle ] ----
     The existing anchors are MOVED (not cloned) so listeners other scripts
     attached to them — e.g. main.js's Lenis smooth-scroll — stay alive. */
  const right = document.createElement("div");
  right.className = "nav-right";
  links.parentNode.insertBefore(right, links);
  right.appendChild(links);

  const cta = links.querySelector(".nav-cta");
  if (cta) right.appendChild(cta); // CTA stays visible in the bar on phones

  if (!links.id) links.id = "nav-menu";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nav-toggle";
  toggle.setAttribute("aria-label", T.open);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", links.id);
  toggle.innerHTML =
    '<span class="nav-toggle-line"></span><span class="nav-toggle-line"></span>';
  right.appendChild(toggle);

  /* ---- State ---- */
  const mq = window.matchMedia("(max-width: 700px)");
  let open = false;
  let savedY = 0;

  /* ---- Body scroll lock (iOS-proof: fixed body keeps visual position) ---- */
  function lockScroll() {
    savedY = window.scrollY;
    const b = document.body.style;
    b.position = "fixed";
    b.top = `-${savedY}px`;
    b.left = "0";
    b.right = "0";
    b.width = "100%";
    b.overflow = "hidden";
  }
  function unlockScroll() {
    const b = document.body.style;
    b.position = b.top = b.left = b.right = b.width = b.overflow = "";
    // "instant" overrides the html { scroll-behavior: smooth } on no-Lenis pages
    window.scrollTo({ top: savedY, left: 0, behavior: "instant" });
  }

  function openMenu() {
    if (open || !mq.matches) return;
    open = true;
    nav.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", T.close);
    lockScroll();
    const first = links.querySelector("a");
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu(returnFocus = true) {
    if (!open) return;
    open = false;
    nav.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", T.open);
    unlockScroll();
    if (returnFocus) toggle.focus({ preventScroll: true });
  }

  toggle.addEventListener("click", () => (open ? closeMenu() : openMenu()));

  // Close on link tap (capture phase, so we run before other handlers).
  // Same-page anchors need special care: main.js's Lenis handler caches the
  // page height, which the scroll lock collapses to one viewport — calling
  // lenis.scrollTo synchronously would clamp the scroll to 0. So for "#..."
  // links we stop Lenis's handler and scroll natively after unlocking, when
  // the layout is fresh again.
  links.addEventListener(
    "click",
    (e) => {
      if (!open) return;
      const a = e.target.closest("a");
      if (!a) return;
      const href = a.getAttribute("href");
      const target =
        href && href.length > 1 && href.startsWith("#")
          ? document.getElementById(href.slice(1))
          : null;
      closeMenu(false);
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
      }
    },
    true
  );

  // Close on tap outside the open panel (the toggle handles itself).
  document.addEventListener("pointerdown", (e) => {
    if (open && !links.contains(e.target) && !toggle.contains(e.target)) {
      closeMenu(false);
    }
  });

  // Escape closes; Tab is trapped inside [first link … toggle] while open.
  document.addEventListener("keydown", (e) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...links.querySelectorAll("a"), toggle];
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (!items.includes(active)) {
      e.preventDefault();
      first.focus();
    }
  });

  // Leaving phone width (rotate / resize) closes the menu and unlocks scroll.
  const onMqChange = () => {
    if (!mq.matches) closeMenu(false);
  };
  if (mq.addEventListener) mq.addEventListener("change", onMqChange);
  else mq.addListener(onMqChange); // older iOS Safari
})();
