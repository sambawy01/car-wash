/* Aqua Blue — Elite Eco Car Wash chat widget (vanilla JS, no dependencies) */
(() => {
  "use strict";

  // Update if the deployment URL changes.
  const CHAT_ENDPOINT =
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
      ? "http://localhost:3000/api/chat"
      : "https://book.eliteecocarwash.com/api/chat";

  const AR = document.documentElement.lang === "ar";
  const CONTACT_EMAIL = "info@eliteecocarwash.com";
  const BOOK_URL = AR
    ? "https://book.eliteecocarwash.com/book?lang=ar"
    : "https://book.eliteecocarwash.com/book";

  const T = AR
    ? {
        open: "فتح الدردشة مع إيكو — مساعد الذكاء الاصطناعي",
        close: "إغلاق الدردشة",
        title: "إيكو — مساعد Elite Eco Car Wash",
        placeholder: "سؤالك…",
        send: "إرسال",
        greeting: "مرحباً! أنا إيكو، مساعد Elite Eco Car Wash. اسألني عن خدماتنا، الأسعار، أو منتجات العناية بالسيارات.",
        teaserName: "تعرّف على إيكو",
        teaserLine: "مساعد الذكاء الاصطناعي — اسأل عن الخدمات والأسعار",
        teaserDismiss: "إخفاء",
        fallbackPre: "أنا غير متصل الآن — راسلنا على ",
        fallbackMid: " أو ",
        fallbackBook: "احجز مباشرة عبر الإنترنت",
      }
    : {
        open: "Open chat with Eco — Elite Eco Car Wash AI Assistant",
        close: "Close chat",
        title: "Eco — Elite Eco Car Wash AI Assistant",
        placeholder: "Your question…",
        send: "Send",
        greeting: "Hello! I'm Eco, Elite Eco Car Wash's AI assistant. Ask me anything about our services, prices, or car care products.",
        teaserName: "Meet Eco",
        teaserLine: "Elite Eco Car Wash AI assistant — ask about services, prices & car care",
        teaserDismiss: "Dismiss",
        fallbackPre: "I'm offline right now — email ",
        fallbackMid: " or ",
        fallbackBook: "book directly online",
      };

  const STORE_KEY = "eecw-chat-history";
  const MAX_HISTORY = 12;

  const loadHistory = () => {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  };
  const saveHistory = (h) => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(h.slice(-MAX_HISTORY))); }
    catch { /* private mode — ignore */ }
  };

  let history = loadHistory();
  let open = false, greeted = false, waiting = false;

  // ---- DOM ----
  const el = (tag, cls, attrs) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  // Launcher: blue water drop icon — Eco's mark.
  const launcher = el("button", "chat-launcher", { type: "button", "aria-label": T.open, "aria-expanded": "false" });
  launcher.innerHTML =
    '<svg viewBox="0 0 64 64" width="50" height="50" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<linearGradient id="ecoBlueFace" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#4FC3F7"/>' +
          '<stop offset="0.38" stop-color="#1A5F9E"/>' +
          '<stop offset="0.62" stop-color="#0D3B66"/>' +
          '<stop offset="1" stop-color="#0A1A2F"/>' +
        '</linearGradient>' +
        '<linearGradient id="ecoBlueEdge" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#0A1A2F"/>' +
          '<stop offset="1" stop-color="#061224"/>' +
        '</linearGradient>' +
      '</defs>' +
      // water drop shape
      '<path d="M32 4 C32 4, 14 28, 14 40 C14 52, 22 60, 32 60 C42 60, 50 52, 50 40 C50 28, 32 4, 32 4 Z" fill="url(#ecoBlueEdge)" />' +
      '<path d="M31 3 C31 3, 13 27, 13 39 C13 51, 21 59, 31 59 C41 59, 49 51, 49 39 C49 27, 31 3, 31 3 Z" fill="url(#ecoBlueFace)" />' +
      // specular highlight
      '<path d="M31 3 C31 3, 13 27, 13 39 C13 51, 21 59, 31 59 C41 59, 49 51, 49 39 C49 27, 31 3, 31 3 Z" fill="none" stroke="#B8D4E8" stroke-width="0.8" opacity="0.5" />' +
      // inner highlight
      '<ellipse cx="26" cy="35" rx="4" ry="8" fill="#E8ECEF" opacity="0.35" transform="rotate(-20 26 35)" />' +
    '</svg>';

  const card = el("section", "chat-card", { role: "dialog", "aria-label": T.title, hidden: "" });

  const header = el("header", "chat-header");
  const title = el("h3", "chat-title");
  title.textContent = T.title;
  const closeBtn = el("button", "chat-close", { type: "button", "aria-label": T.close });
  closeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  header.append(title, closeBtn);

  const list = el("div", "chat-messages", { "aria-live": "polite" });

  const form = el("form", "chat-input");
  const input = el("input", "", { type: "text", placeholder: T.placeholder, "aria-label": T.placeholder, autocomplete: "off" });
  const sendBtn = el("button", "chat-send", { type: "submit", "aria-label": T.send });
  sendBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  form.append(input, sendBtn);

  card.append(header, list, form);

  // ---- Intro teaser ----
  const INTRO_KEY = "eecw-eco-intro-seen";
  const introSeen = () => {
    try { return sessionStorage.getItem(INTRO_KEY) === "1"; }
    catch { return true; }
  };
  const markIntroSeen = () => {
    try { sessionStorage.setItem(INTRO_KEY, "1"); } catch { /* ignore */ }
  };

  const teaser = el("aside", "chat-teaser", { hidden: "" });
  const teaserBody = el("button", "chat-teaser-body", { type: "button", "aria-label": T.open });
  const teaserName = el("strong", "chat-teaser-name");
  teaserName.textContent = T.teaserName;
  const teaserLine = el("span", "chat-teaser-line");
  teaserLine.textContent = T.teaserLine;
  teaserBody.append(teaserName, teaserLine);
  const teaserClose = el("button", "chat-teaser-close", { type: "button", "aria-label": T.teaserDismiss });
  teaserClose.innerHTML =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  teaser.append(teaserBody, teaserClose);

  document.body.append(launcher, teaser, card);

  const hideTeaser = () => {
    if (teaser.hidden) return;
    teaser.classList.remove("show");
    teaser.hidden = true;
    markIntroSeen();
  };

  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!introSeen()) {
    setTimeout(() => {
      if (open) return;
      teaser.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => teaser.classList.add("show")));
    }, REDUCED ? 0 : 1500);
  } else {
    launcher.classList.add("calm");
  }

  teaserClose.addEventListener("click", hideTeaser);

  // ---- Safe rendering ----
  const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
  const renderText = (node, text) => {
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
      if (m.index > last) node.append(text.slice(last, m.index));
      const a = el("a", "chat-link", { href: m[0], target: "_blank", rel: "noopener noreferrer" });
      a.textContent = m[0];
      node.append(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) node.append(text.slice(last));
  };

  const addBubble = (role, text) => {
    const b = el("div", "chat-bubble chat-" + role);
    renderText(b, text);
    list.append(b);
    list.scrollTop = list.scrollHeight;
    return b;
  };

  const addFallback = () => {
    const b = el("div", "chat-bubble chat-assistant");
    b.append(T.fallbackPre);
    const mail = el("a", "chat-link", { href: "mailto:" + CONTACT_EMAIL });
    mail.textContent = CONTACT_EMAIL;
    const book = el("a", "chat-link", { href: BOOK_URL, target: "_blank", rel: "noopener noreferrer" });
    book.textContent = T.fallbackBook;
    b.append(mail, T.fallbackMid, book, ".");
    list.append(b);
    list.scrollTop = list.scrollHeight;
  };

  let typingEl = null;
  const showTyping = (on) => {
    if (on && !typingEl) {
      typingEl = el("div", "chat-bubble chat-assistant chat-typing", { "aria-hidden": "true" });
      typingEl.innerHTML = "<span></span><span></span><span></span>";
      list.append(typingEl);
      list.scrollTop = list.scrollHeight;
    } else if (!on && typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  };

  // ---- Open / close ----
  const setOpen = (v) => {
    open = v;
    card.hidden = !v;
    launcher.setAttribute("aria-expanded", String(v));
    if (v) {
      hideTeaser();
      markIntroSeen();
      launcher.classList.add("calm");
      if (!greeted) {
        greeted = true;
        if (history.length) history.forEach((m) => addBubble(m.role, m.content));
        else addBubble("assistant", T.greeting);
      }
      input.focus();
      list.scrollTop = list.scrollHeight;
    } else {
      launcher.focus();
    }
  };

  launcher.addEventListener("click", () => setOpen(!open));
  teaserBody.addEventListener("click", () => setOpen(true));
  closeBtn.addEventListener("click", () => setOpen(false));
  card.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });

  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("[data-open-chat]");
    if (!t) return;
    e.preventDefault();
    setOpen(true);
    card.scrollIntoView({ block: "nearest" });
  });

  // ---- Send ----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || waiting) return;
    input.value = "";

    addBubble("user", text);
    history.push({ role: "user", content: text });
    saveHistory(history);

    waiting = true;
    sendBtn.disabled = true;
    showTyping(true);

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-MAX_HISTORY), lang: AR ? "ar" : "en" }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const reply = (await res.json()).reply;
      if (typeof reply !== "string" || !reply) throw new Error("bad payload");
      history.push({ role: "assistant", content: reply });
      saveHistory(history);
      showTyping(false);
      addBubble("assistant", reply);
    } catch {
      showTyping(false);
      addFallback();
    }

    waiting = false;
    sendBtn.disabled = false;
    input.focus();
  });
})();
