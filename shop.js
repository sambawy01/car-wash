/* ===== Elite Eco Car Wash Shop — products, cart, cash-on-delivery order flow =====
   Vanilla IIFE, no dependencies. Cart persists in localStorage ("eecw-cart").
   Order POSTs { items:[{slug, qty}], name, phone, email?, address, note, lang }
   to /api/order on the booking host. `email` is optional — when provided the
   server sends the buyer an order-confirmation email. */
(function () {
  "use strict";

  /* =====================================================================
     EMBEDDED PRODUCT DATA — OFFLINE FALLBACK ONLY.
     The live catalog is fetched from GET <API_BASE>/api/products (admin
     edits it from the admin panel); this embedded copy renders only when
     that fetch fails, so the shop never goes blank. It mirrors the SEED
     catalog in vercel-app/src/lib/catalog.ts.
     `photo` points at a 900×900 JPEG in assets/img/shop/ (the API may also
     return absolute blob URLs for uploaded photos).
     `alt` is the per-language image description. If `photo` is null the
     card falls back to the tinted-gradient-and-initial placeholder art.
     `desc` is short marketing copy, rendered in the product detail modal.
     Prices: `egp` in Egyptian pounds only.
     ===================================================================== */
  var EMBEDDED_PRODUCTS = [
    {
      slug: "premium-car-shampoo",
      name: { en: "Premium Car Shampoo", ar: "شامبو سيارات فاخر" },
      sub: { en: "1L", ar: "1 لتر" },
      egp: 180,
      initial: { en: "S", ar: "ش" }, tintA: "#DCE4EC", tintB: "#B7C6D6",
      photo: "assets/img/shop/premium-car-shampoo.jpg",
      alt: {
        en: "Premium car shampoo bottle — deep blue with silver cap",
        ar: "زجاجة شامبو سيارات فاخر — أزرق داكن بغطاء فضي"
      },
      desc: {
        en: "pH-neutral, high-foam shampoo that lifts dirt gently without stripping wax or sealant. Safe for all paint types, biodegradable formula.",
        ar: "شامبو متعادل الحموضة برغوة عالية يرفع الأوساخ بلطف دون إزالة الشمع أو السيراميك. آمن لجميع أنواع الطلاء، صديق للبيئة."
      }
    },
    {
      slug: "ceramic-wax-spray",
      name: { en: "Ceramic Wax Spray", ar: "سيراميك وكس سبراي" },
      sub: { en: "500ml", ar: "500 مل" },
      egp: 250,
      initial: { en: "C", ar: "س" }, tintA: "#E0D8CE", tintB: "#BFB1A2",
      photo: "assets/img/shop/ceramic-wax-spray.jpg",
      alt: {
        en: "Ceramic wax spray bottle — silver with blue label",
        ar: "زجاجة سيراميك وكس سبراي — فضية بملصق أزرق"
      },
      desc: {
        en: "Spray-on ceramic protection that bonds to paint for months of water-beading shine. Quick application, no machine needed. UV-resistant.",
        ar: "حماية سيراميك بالبخاخ ترتبط بالطلاء لأشهر من لمعان يصد الماء. تطبيق سريع، لا يحتاج ماكينة. مقاوم للأشعة فوق البنفسجية."
      }
    },
    {
      slug: "microfiber-cloth-set",
      name: { en: "Microfiber Cloth Set", ar: "طقم أقمشة مايكروفايبر" },
      sub: { en: "3 pack", ar: "3 قطع" },
      egp: 120,
      initial: { en: "M", ar: "م" }, tintA: "#F4E6C4", tintB: "#E2CC98",
      photo: "assets/img/shop/microfiber-cloth-set.jpg",
      alt: {
        en: "Pack of three microfiber cloths — blue, grey, and white",
        ar: "طقم ثلاث أقمشة مايكروفايبر — أزرق ورمادي وأبيض"
      },
      desc: {
        en: "Ultra-soft, lint-free microfiber cloths for streak-free drying and polishing. 350 GSM, machine washable, scratch-safe on all surfaces.",
        ar: "أقمشة مايكروفايبر ناعمة فائقة خالية من الوبر لتجفيف وتلميع بدون خطوط. 350 جرام، قابلة للغسل في الغسالة، آمنة على جميع الأسطح."
      }
    },
    {
      slug: "tire-shine-gel",
      name: { en: "Tire Shine Gel", ar: "جل تلميع الإطارات" },
      sub: { en: "500ml", ar: "500 مل" },
      egp: 150,
      initial: { en: "T", ar: "إ" }, tintA: "#EFE0C8", tintB: "#DCC29B",
      photo: "assets/img/shop/tire-shine-gel.jpg",
      alt: {
        en: "Tire shine gel bottle — black with blue accent",
        ar: "زجاجة جل تلميع الإطارات — أسود بلمسة زرقاء"
      },
      desc: {
        en: "Long-lasting gel that gives tires a rich, satin-black finish. Water-resistant, no sling formula. Lasts up to 2 weeks per application.",
        ar: "جل طويل الأمد يعطي الإطارات لمعة ساتان سوداء غنية. مقاوم للماء، بدون تطاير. يدوم حتى أسبوعين لكل تطبيق."
      }
    },
    {
      slug: "interior-cleaner-spray",
      name: { en: "Interior Cleaner Spray", ar: "منظف الداخل سبراي" },
      sub: { en: "750ml", ar: "750 مل" },
      egp: 130,
      initial: { en: "I", ar: "د" }, tintA: "#DCE4EC", tintB: "#B7C6D6",
      photo: "assets/img/shop/interior-cleaner-spray.jpg",
      alt: {
        en: "Interior cleaner spray — white bottle with blue trigger",
        ar: "سبراي منظف الداخل — زجاجة بيضاء بزر أزرق"
      },
      desc: {
        en: "Multi-surface cleaner for dashboard, doors, leather, and plastic. Lifts dust and oils without leaving residue or greasy film. Fresh scent.",
        ar: "منظف متعدد الأسطح للوحة القيادة والأبواب والجلد والبلاستيك. يرفع الغبار والزيوت دون ترك بقايا أو طبقة دهنية. رائحة منعشة."
      }
    },
    {
      slug: "waterless-wash-spray",
      name: { en: "Waterless Wash Spray", ar: "سبراي غسيل بدون مياه" },
      sub: { en: "500ml", ar: "500 مل" },
      egp: 220,
      initial: { en: "W", ar: "غ" }, tintA: "#E0D8CE", tintB: "#BFB1A2",
      photo: "assets/img/shop/waterless-wash-spray.jpg",
      alt: {
        en: "Waterless wash spray — blue bottle with spray nozzle",
        ar: "سبراي غسيل بدون مياه — زجاجة زرقاء بفوهة بخاخ"
      },
      desc: {
        en: "Eco-friendly waterless wash that encapsulates dirt for scratch-free removal. Leaves a glossy protective layer. Saves up to 150 litres per wash.",
        ar: "غسيل صديق للبيئة بدون مياه يحاصر الأوساخ للإزالة بدون خدش. يترك طبقة واقية لامعة. يوفر حتى 150 لتر لكل غسلة."
      }
    }
  ];
  /* ========================= end PRODUCT DATA ========================= */

  /* The render-time catalog. Starts as the embedded fallback and is
     replaced by the live API catalog before first render when available. */
  var PRODUCTS = EMBEDDED_PRODUCTS;

  var LANG = (document.documentElement.lang || "en").toLowerCase().indexOf("ar") === 0 ? "ar" : "en";
  var STORAGE_KEY = "eecw-cart";
  var PHONE_RE = /^\+?[0-9\s\-()]{8,17}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var API_BASE = IS_LOCAL
    ? "http://localhost:3000"
    : "https://book.eliteecocarwash.com";
  var API_URL = API_BASE + "/api/order";
  var PRODUCTS_URL = API_BASE + "/api/products";
  var MAIL_TO = "info@eliteecocarwash.com";

  var T = {
    en: {
      add: "Add to order",
      soldOut: "Sold out",
      view: "View details",
      decrease: "Decrease quantity",
      increase: "Increase quantity",
      qtyOf: "Quantity of",
      inCart: "in cart",
      itemOne: "item",
      reviewOrder: "Review order",
      panelTitle: "Your order",
      close: "Close",
      total: "Total",
      cod: "Payment: cash on delivery. Our team will contact you to confirm your order and delivery time.",
      delivery: "Delivery within 24–72 hours across Egypt.",
      name: "Your name",
      namePh: "Ahmed",
      nameErr: "Please tell us your name.",
      phone: "Mobile",
      phonePh: "+20 100 123 4567",
      phoneErr: "Please enter a valid phone number with country code, e.g. +20 100 123 4567.",
      email: "Email (for order confirmation)",
      emailPh: "ahmed@example.com",
      emailErr: "Please enter a valid email address, e.g. ahmed@example.com.",
      address: "City & address",
      addressPh: "City, street, building…",
      addressErr: "Please tell us where to deliver.",
      note: "Note (optional)",
      notePh: "Anything we should know",
      submit: "Place order",
      sending: "Sending…",
      successTitle: "Thank you — order placed!",
      orderNumberLabel: "Order number: ",
      successLine: "Our team will get in touch via WhatsApp to confirm your delivery time. Payment on delivery.",
      done: "Done",
      failLead: "We couldn't send your order right now.",
      failLink: "Email it to us instead",
      failTail: "— your cart is kept safe on this device.",
      mailSubject: "Order request — Elite Eco Car Wash Shop",
      mailOrder: "Order:",
      mailName: "Name:",
      mailPhone: "Phone:",
      mailEmail: "Email:",
      mailAddress: "Address:",
      mailNote: "Note:",
      mailTotal: "Total:"
    },
    ar: {
      add: "أضف للطلب",
      soldOut: "غير متوفر",
      view: "عرض التفاصيل",
      decrease: "إنقاص الكمية",
      increase: "زيادة الكمية",
      qtyOf: "كمية:",
      inCart: "في السلة",
      itemOne: "منتج",
      reviewOrder: "مراجعة الطلب",
      panelTitle: "طلبك",
      close: "إغلاق",
      total: "المجموع",
      cod: "الدفع عند الاستلام. سيتواصل معك فريقنا لتأكيد طلبك ووقت التوصيل.",
      delivery: "التوصيل خلال 24–72 ساعة في جميع أنحاء مصر.",
      name: "اسمك",
      namePh: "أحمد",
      nameErr: "يرجى إخبارنا باسمك.",
      phone: "رقم الهاتف",
      phonePh: "+20 100 123 4567",
      phoneErr: "يرجى إدخال رقم هاتف صحيح مع رمز الدولة، مثلاً +20 100 123 4567.",
      email: "البريد الإلكتروني (لتأكيد الطلب)",
      emailPh: "ahmed@example.com",
      emailErr: "يرجى إدخال بريد إلكتروني صحيح، مثلاً ahmed@example.com.",
      address: "المدينة والعنوان",
      addressPh: "المدينة، الشارع، المبنى…",
      addressErr: "يرجى إخبارنا أين نوصّل.",
      note: "ملاحظة (اختياري)",
      notePh: "أي شيء يجب أن نعرفه",
      submit: "تقديم الطلب",
      sending: "جارٍ الإرسال…",
      successTitle: "شكراً — تم تقديم الطلب!",
      orderNumberLabel: "رقم الطلب: ",
      successLine: "سيتواصل معك فريقنا عبر واتساب لتأكيد وقت التوصيل. الدفع عند الاستلام.",
      done: "تم",
      failLead: "تعذّر إرسال طلبك في الوقت الحالي.",
      failLink: "أرسله بالبريد الإلكتروني بدلاً من ذلك",
      failTail: "— سلتك محفوظة على هذا الجهاز.",
      mailSubject: "طلب — متجر Elite Eco Car Wash",
      mailOrder: "الطلب:",
      mailName: "الاسم:",
      mailPhone: "الهاتف:",
      mailEmail: "البريد:",
      mailAddress: "العنوان:",
      mailNote: "ملاحظة:",
      mailTotal: "المجموع:"
    }
  }[LANG];

  /* ---------- helpers ---------- */
  function bySlug(slug) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].slug === slug) return PRODUCTS[i];
    return null;
  }
  function embeddedBySlug(slug) {
    for (var i = 0; i < EMBEDDED_PRODUCTS.length; i++) if (EMBEDDED_PRODUCTS[i].slug === slug) return EMBEDDED_PRODUCTS[i];
    return null;
  }
  function langPair(obj) {
    obj = obj || {};
    return { en: typeof obj.en === "string" ? obj.en : "", ar: typeof obj.ar === "string" ? obj.ar : "" };
  }
  /* Map the public API catalog ({slug, name, sub, desc, priceEgp,
     photo, alt, soldOut}) onto the renderer's product shape. Tints and the
     placeholder initial are reused from the embedded copy when the slug is
     known, otherwise derived/defaulted. `photo` may be a site-relative path
     (assets/img/shop/x.jpg) or an absolute blob URL — <img src> takes both. */
  function adoptApiProducts(list) {
    var mapped = [];
    for (var i = 0; i < list.length; i++) {
      var ap = list[i] || {};
      if (typeof ap.slug !== "string" || !ap.slug) continue;
      if (typeof ap.priceEgp !== "number") continue;
      var base = embeddedBySlug(ap.slug);
      var name = langPair(ap.name);
      if (!name.en && !name.ar) continue;
      if (!name.en) name.en = name.ar;
      if (!name.ar) name.ar = name.en;
      mapped.push({
        slug: ap.slug,
        name: name,
        sub: langPair(ap.sub),
        desc: langPair(ap.desc),
        alt: langPair(ap.alt),
        egp: ap.priceEgp,
        photo: typeof ap.photo === "string" && ap.photo ? ap.photo : null,
        soldOut: !!ap.soldOut,
        initial: base ? base.initial : { en: (name.en.charAt(0) || "·").toUpperCase(), ar: (name.ar.charAt(0) || "·") },
        tintA: base ? base.tintA : "#DCE4EC",
        tintB: base ? base.tintB : "#B7C6D6"
      });
    }
    return mapped;
  }
  function fmtEgp(n) { return "E£" + n.toLocaleString("en-US"); }
  function itemsWord(n) {
    if (LANG === "ar") {
      return n === 1 ? "منتج" : "منتجات";
    }
    return n === 1 ? "item" : "items";
  }
  /* ---------- cart state ---------- */
  var cart = {}; // slug -> qty
  function loadCart() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      for (var slug in raw) {
        var product = bySlug(slug);
        if (product && !product.soldOut && typeof raw[slug] === "number") {
          var q = Math.floor(raw[slug]);
          if (q >= 1) cart[slug] = Math.min(q, 99);
        }
      }
    } catch (e) { cart = {}; }
  }
  function saveCart() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch (e) { /* private mode */ }
  }
  function cartCount() { var n = 0; for (var s in cart) n += cart[s]; return n; }
  function cartTotals() {
    var egp = 0;
    for (var s in cart) { var p = bySlug(s); egp += p.egp * cart[s]; }
    return { egp: egp };
  }
  function setQty(slug, qty) {
    var product = bySlug(slug);
    if (!product || product.soldOut) return;
    if (qty <= 0) delete cart[slug]; else cart[slug] = Math.min(qty, 99);
    saveCart();
    renderAction(slug);
    renderBar();
    announce(slug);
  }

  /* ---------- screen-reader announcements ---------- */
  var live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  document.body.appendChild(live);
  function announce(slug) {
    var p = bySlug(slug);
    var q = cart[slug] || 0;
    live.textContent = p.name[LANG] + " — " + q + " " + T.inCart;
  }

  /* ---------- product grid ---------- */
  var grid = document.getElementById("shop-grid");
  var actionEls = {}; // slug -> .shop-action element

  function fillAction(holder, slug) {
    var p = bySlug(slug);
    holder.textContent = "";
    if (p.soldOut) {
      var so = document.createElement("button");
      so.type = "button";
      so.className = "shop-add shop-add-soldout";
      so.disabled = true;
      so.setAttribute("aria-disabled", "true");
      so.textContent = T.soldOut;
      so.setAttribute("aria-label", T.soldOut + " — " + p.name[LANG]);
      so.style.opacity = "0.55";
      so.style.cursor = "default";
      holder.appendChild(so);
      return;
    }
    if (!cart[slug]) {
      var add = document.createElement("button");
      add.type = "button";
      add.className = "shop-add";
      add.textContent = T.add;
      add.setAttribute("aria-label", T.add + " — " + p.name[LANG]);
      add.addEventListener("click", function () { setQty(slug, 1); });
      holder.appendChild(add);
    } else {
      var stepper = document.createElement("div");
      stepper.className = "shop-stepper";
      stepper.setAttribute("role", "group");
      stepper.setAttribute("aria-label", T.qtyOf + " " + p.name[LANG]);
      var minus = document.createElement("button");
      minus.type = "button";
      minus.className = "shop-step";
      minus.textContent = "−";
      minus.setAttribute("aria-label", T.decrease + " — " + p.name[LANG]);
      minus.addEventListener("click", function () { setQty(slug, (cart[slug] || 0) - 1); });
      var qty = document.createElement("span");
      qty.className = "shop-qty";
      qty.textContent = String(cart[slug]);
      var plus = document.createElement("button");
      plus.type = "button";
      plus.className = "shop-step";
      plus.textContent = "+";
      plus.setAttribute("aria-label", T.increase + " — " + p.name[LANG]);
      plus.addEventListener("click", function () { setQty(slug, (cart[slug] || 0) + 1); });
      stepper.appendChild(minus);
      stepper.appendChild(qty);
      stepper.appendChild(plus);
      holder.appendChild(stepper);
    }
  }

  function renderAction(slug) {
    if (actionEls[slug]) fillAction(actionEls[slug], slug);
    if (pActionHolder && pSlug === slug) {
      fillAction(pActionHolder, slug);
      if (pPanel && !pPanel.contains(document.activeElement)) {
        var next = pActionHolder.querySelector("button");
        if (next) next.focus();
      }
    }
  }

  function buildArt(p, cls, eager) {
    var art = document.createElement("div");
    art.className = cls;
    art.style.setProperty("--tint-a", p.tintA);
    art.style.setProperty("--tint-b", p.tintB);
    if (p.photo) {
      var img = document.createElement("img");
      img.src = p.photo;
      img.alt = (p.alt && p.alt[LANG]) || p.name[LANG];
      img.width = 900;
      img.height = 900;
      if (!eager) img.loading = "lazy";
      img.decoding = "async";
      art.appendChild(img);
    } else {
      var ini = document.createElement("span");
      ini.className = "shop-initial";
      ini.setAttribute("aria-hidden", "true");
      ini.textContent = p.initial[LANG];
      art.appendChild(ini);
    }
    if (p.soldOut) {
      art.style.position = "relative";
      var badge = document.createElement("span");
      badge.className = "shop-soldout-badge";
      badge.textContent = T.soldOut;
      badge.style.cssText =
        "position:absolute;top:12px;left:12px;z-index:2;" +
        "padding:5px 12px;border-radius:999px;" +
        "background:rgba(10,26,47,0.82);color:#F8FAFC;" +
        "font-size:12px;letter-spacing:0.08em;text-transform:uppercase;" +
        "pointer-events:none;";
      art.appendChild(badge);
      if (p.photo) {
        var im = art.querySelector("img");
        if (im) { im.style.opacity = "0.55"; im.style.filter = "grayscale(35%)"; }
      }
    }
    return art;
  }

  function renderGrid() {
    if (!grid) return;
    PRODUCTS.forEach(function (p) {
      var card = document.createElement("article");
      card.className = "shop-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-haspopup", "dialog");
      card.setAttribute("aria-label", p.name[LANG] + " — " + T.view);
      card.addEventListener("click", function () { openProduct(p.slug); });
      card.addEventListener("keydown", function (ev) {
        if (ev.target !== card) return;
        if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
          ev.preventDefault();
          openProduct(p.slug);
        }
      });

      var art = buildArt(p, "shop-art");

      var body = document.createElement("div");
      body.className = "shop-body";
      var name = document.createElement("h2");
      name.className = "shop-name";
      name.textContent = p.name[LANG];
      var sub = document.createElement("p");
      sub.className = "shop-sub";
      sub.textContent = p.sub[LANG];
      var price = document.createElement("p");
      price.className = "shop-price";
      price.appendChild(document.createTextNode(fmtEgp(p.egp)));
      var action = document.createElement("div");
      action.className = "shop-action";
      action.addEventListener("click", function (ev) { ev.stopPropagation(); });
      actionEls[p.slug] = action;

      body.appendChild(name);
      body.appendChild(sub);
      body.appendChild(price);
      body.appendChild(action);
      card.appendChild(art);
      card.appendChild(body);
      grid.appendChild(card);
      renderAction(p.slug);
    });
  }

  /* ---------- product detail modal ---------- */
  var pOverlay = null, pPanel = null, pActionHolder = null, pSlug = null, pLastFocus = null;

  function pTrapKeydown(ev) {
    if (ev.key === "Escape") { ev.preventDefault(); closeProduct(); return; }
    if (ev.key !== "Tab") return;
    var focusables = pPanel.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = document.activeElement;
    if (!pPanel.contains(active) || active === pPanel) {
      ev.preventDefault();
      (ev.shiftKey ? last : first).focus();
      return;
    }
    if (ev.shiftKey && active === first) {
      ev.preventDefault(); last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault(); first.focus();
    }
  }

  function openProduct(slug) {
    var p = bySlug(slug);
    if (!p) return;
    if (pOverlay) closeProduct();
    pLastFocus = document.activeElement;
    pSlug = slug;

    pOverlay = el("div", "pmodal-overlay");
    pPanel = el("div", "pmodal");
    pPanel.setAttribute("role", "dialog");
    pPanel.setAttribute("aria-modal", "true");
    pPanel.setAttribute("aria-labelledby", "pmodal-title");
    pPanel.tabIndex = -1;

    var close = el("button", "pmodal-close");
    close.type = "button";
    close.setAttribute("aria-label", T.close);
    close.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    close.addEventListener("click", closeProduct);

    var art = buildArt(p, "pmodal-art", true);

    var body = el("div", "pmodal-body");
    var name = el("h2", "pmodal-title", p.name[LANG]);
    name.id = "pmodal-title";
    var sub = el("p", "pmodal-sub", p.sub[LANG]);
    var desc = el("p", "pmodal-desc", (p.desc && p.desc[LANG]) || "");
    var price = el("p", "pmodal-price", fmtEgp(p.egp));
    pActionHolder = el("div", "pmodal-action");
    fillAction(pActionHolder, slug);

    body.appendChild(name);
    body.appendChild(sub);
    body.appendChild(desc);
    body.appendChild(price);
    body.appendChild(pActionHolder);
    pPanel.appendChild(close);
    pPanel.appendChild(art);
    pPanel.appendChild(body);
    pOverlay.appendChild(pPanel);

    pOverlay.addEventListener("mousedown", function (ev) {
      if (ev.target === pOverlay) closeProduct();
    });
    document.body.appendChild(pOverlay);
    document.documentElement.classList.add("pmodal-open");
    document.addEventListener("keydown", pTrapKeydown, true);
    pPanel.focus();
  }

  function closeProduct() {
    if (!pOverlay) return;
    pOverlay.remove();
    pOverlay = null;
    pPanel = null;
    pActionHolder = null;
    pSlug = null;
    document.documentElement.classList.remove("pmodal-open");
    document.removeEventListener("keydown", pTrapKeydown, true);
    if (pLastFocus && document.contains(pLastFocus)) pLastFocus.focus();
  }

  /* ---------- floating cart bar ---------- */
  var bar = document.createElement("button");
  bar.type = "button";
  bar.className = "cart-bar";
  bar.hidden = true;
  var barSum = document.createElement("span");
  barSum.className = "cart-bar-sum";
  var barCta = document.createElement("span");
  barCta.className = "cart-bar-cta";
  barCta.textContent = T.reviewOrder + " →";
  bar.appendChild(barSum);
  bar.appendChild(barCta);
  bar.addEventListener("click", openPanel);
  document.body.appendChild(bar);

  function renderBar() {
    var n = cartCount();
    if (n === 0) { bar.hidden = true; return; }
    var totals = cartTotals();
    barSum.textContent = n + " " + itemsWord(n) + " · " + fmtEgp(totals.egp);
    bar.hidden = false;
  }

  /* ---------- order panel ---------- */
  var overlay = null, panel = null, lastFocus = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function field(id, labelText, errText, control) {
    var wrap = el("div", "order-field");
    var label = el("label", null, labelText);
    label.setAttribute("for", id);
    control.id = id;
    var err = el("p", "field-error", errText || "");
    err.id = id + "-error";
    if (errText) control.setAttribute("aria-describedby", err.id);
    wrap.appendChild(label);
    wrap.appendChild(control);
    if (errText) wrap.appendChild(err);
    return wrap;
  }

  function markInvalid(control, invalid) {
    control.parentNode.classList.toggle("invalid", !!invalid);
    control.setAttribute("aria-invalid", invalid ? "true" : "false");
  }

  function mailtoHref() {
    var totals = cartTotals();
    var lines = [T.mailOrder];
    for (var s in cart) {
      var p = bySlug(s);
      lines.push("· " + p.name[LANG] + " (" + p.sub[LANG] + ") × " + cart[s] + " — " + fmtEgp(p.egp * cart[s]));
    }
    lines.push(T.mailTotal + " " + fmtEgp(totals.egp));
    var f = panel ? panel.querySelector("form") : null;
    if (f) {
      lines.push("");
      lines.push(T.mailName + " " + (f.elements["order-name"].value || "—"));
      lines.push(T.mailPhone + " " + (f.elements["order-phone"].value || "—"));
      if (f.elements["order-email"].value) lines.push(T.mailEmail + " " + f.elements["order-email"].value);
      lines.push(T.mailAddress + " " + (f.elements["order-address"].value || "—"));
      if (f.elements["order-note"].value) lines.push(T.mailNote + " " + f.elements["order-note"].value);
    }
    return "mailto:" + MAIL_TO +
      "?subject=" + encodeURIComponent(T.mailSubject) +
      "&body=" + encodeURIComponent(lines.join("\n"));
  }

  function buildPanel() {
    overlay = el("div", "order-overlay");
    panel = el("div", "order-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "order-title");
    panel.tabIndex = -1;

    var close = el("button", "order-close");
    close.type = "button";
    close.setAttribute("aria-label", T.close);
    close.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    close.addEventListener("click", closePanel);

    var title = el("h2", "order-title", T.panelTitle);
    title.id = "order-title";

    var list = el("ul", "order-items");
    var total = el("p", "order-total");
    var cod = el("p", "cod-note", T.cod);
    cod.appendChild(document.createElement("br"));
    cod.appendChild(document.createTextNode(T.delivery));

    var form = el("form", "order-form");
    form.noValidate = true;

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.name = "order-name";
    nameInput.placeholder = T.namePh;
    nameInput.autocomplete = "name";

    var phoneInput = document.createElement("input");
    phoneInput.type = "tel";
    phoneInput.name = "order-phone";
    phoneInput.placeholder = T.phonePh;
    phoneInput.autocomplete = "tel";
    phoneInput.inputMode = "tel";

    var emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.name = "order-email";
    emailInput.placeholder = T.emailPh;
    emailInput.autocomplete = "email";
    emailInput.inputMode = "email";

    var addressInput = document.createElement("textarea");
    addressInput.name = "order-address";
    addressInput.rows = 2;
    addressInput.placeholder = T.addressPh;
    addressInput.autocomplete = "street-address";

    var noteInput = document.createElement("textarea");
    noteInput.name = "order-note";
    noteInput.rows = 2;
    noteInput.placeholder = T.notePh;

    var fail = el("div", "order-fail");
    fail.hidden = true;

    var submit = el("button", "order-submit", T.submit);
    submit.type = "submit";

    form.appendChild(field("order-name", T.name, T.nameErr, nameInput));
    form.appendChild(field("order-phone", T.phone, T.phoneErr, phoneInput));
    form.appendChild(field("order-email", T.email, T.emailErr, emailInput));
    form.appendChild(field("order-address", T.address, T.addressErr, addressInput));
    form.appendChild(field("order-note", T.note, null, noteInput));
    form.appendChild(fail);
    form.appendChild(submit);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var ok = true;
      var nameOk = nameInput.value.trim().length >= 2;
      markInvalid(nameInput, !nameOk); ok = ok && nameOk;
      var phoneOk = PHONE_RE.test(phoneInput.value.trim());
      markInvalid(phoneInput, !phoneOk); ok = ok && phoneOk;
      var emailVal = emailInput.value.trim();
      var emailOk = emailVal === "" || (emailVal.length <= 120 && EMAIL_RE.test(emailVal));
      markInvalid(emailInput, !emailOk); ok = ok && emailOk;
      var addrOk = addressInput.value.trim().length >= 5;
      markInvalid(addressInput, !addrOk); ok = ok && addrOk;
      if (!ok) {
        var firstBad = panel.querySelector(".order-field.invalid input, .order-field.invalid textarea");
        if (firstBad) firstBad.focus();
        return;
      }
      fail.hidden = true;
      submit.disabled = true;
      submit.textContent = T.sending;

      var items = [];
      for (var s in cart) items.push({ slug: s, qty: cart[s] });
      var payload = {
        items: items,
        name: nameInput.value.trim(),
        phone: phoneInput.value.trim(),
        address: addressInput.value.trim(),
        note: noteInput.value.trim(),
        lang: LANG
      };
      if (emailVal) payload.email = emailVal;

      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (res.status === 400) {
          return res.json().then(function (data) {
            var messages = [];
            if (data && data.fields) {
              for (var k in data.fields) {
                if (typeof data.fields[k] === "string") messages.push(data.fields[k]);
              }
            }
            throw { validation: messages.length ? messages : [(data && data.error) || "Validation failed"] };
          }, function () { throw new Error("HTTP 400"); });
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json().catch(function () { return {}; });
      }).then(function (data) {
        showSuccess(data && typeof data.orderNumber === "string" ? data.orderNumber : "");
      }).catch(function (err) {
        submit.disabled = false;
        submit.textContent = T.submit;
        fail.textContent = "";
        if (err && err.validation) {
          for (var i = 0; i < err.validation.length; i++) {
            if (i > 0) fail.appendChild(document.createElement("br"));
            fail.appendChild(document.createTextNode(err.validation[i]));
          }
        } else {
          fail.appendChild(document.createTextNode(T.failLead + " "));
          var a = document.createElement("a");
          a.href = mailtoHref();
          a.textContent = T.failLink;
          fail.appendChild(a);
          fail.appendChild(document.createTextNode(" " + T.failTail));
        }
        fail.hidden = false;
      });
    });

    panel.appendChild(close);
    panel.appendChild(title);
    panel.appendChild(list);
    panel.appendChild(total);
    panel.appendChild(cod);
    panel.appendChild(form);
    overlay.appendChild(panel);

    overlay.addEventListener("mousedown", function (ev) {
      if (ev.target === overlay) closePanel();
    });
    document.body.appendChild(overlay);
  }

  function renderPanelItems() {
    var list = panel.querySelector(".order-items");
    var total = panel.querySelector(".order-total");
    list.textContent = "";
    for (var s in cart) {
      var p = bySlug(s);
      var li = document.createElement("li");
      var name = el("span", "order-item-name", p.name[LANG] + " ");
      name.appendChild(el("span", "order-item-qty", "× " + cart[s]));
      li.appendChild(name);
      li.appendChild(el("span", "order-item-price", fmtEgp(p.egp * cart[s])));
      list.appendChild(li);
    }
    var totals = cartTotals();
    total.textContent = "";
    total.appendChild(el("span", null, T.total));
    total.appendChild(el("span", "order-total-sum", fmtEgp(totals.egp)));
  }

  function showSuccess(orderNumber) {
    panel.textContent = "";
    var box = el("div", "order-success");
    var mark = el("div", "order-success-mark");
    mark.setAttribute("aria-hidden", "true");
    mark.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M4 11.5l5 5L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var title = el("h2", "order-success-title", T.successTitle);
    title.id = "order-title";
    var line = el("p", "order-success-line", T.successLine);
    var deliveryLine = el("p", "order-success-line", T.delivery);
    var done = el("button", "order-submit", T.done);
    done.type = "button";
    done.addEventListener("click", closePanel);
    box.appendChild(mark);
    box.appendChild(title);
    if (orderNumber) {
      var numLine = el("p", "order-success-line order-success-num");
      numLine.appendChild(el("strong", null, T.orderNumberLabel + orderNumber));
      box.appendChild(numLine);
    }
    box.appendChild(line);
    box.appendChild(deliveryLine);
    box.appendChild(done);
    panel.appendChild(box);
    done.focus();
    cart = {};
    saveCart();
    PRODUCTS.forEach(function (p) { renderAction(p.slug); });
    renderBar();
  }

  function trapKeydown(ev) {
    if (ev.key === "Escape") { ev.preventDefault(); closePanel(); return; }
    if (ev.key !== "Tab") return;
    var focusables = panel.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = document.activeElement;
    if (!panel.contains(active) || active === panel) {
      ev.preventDefault();
      (ev.shiftKey ? last : first).focus();
      return;
    }
    if (ev.shiftKey && active === first) {
      ev.preventDefault(); last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault(); first.focus();
    }
  }

  function openPanel() {
    if (cartCount() === 0) return;
    lastFocus = document.activeElement;
    if (overlay) { overlay.remove(); overlay = null; panel = null; }
    buildPanel();
    renderPanelItems();
    document.documentElement.classList.add("order-open");
    document.addEventListener("keydown", trapKeydown, true);
    panel.focus();
  }

  function closePanel() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    panel = null;
    document.documentElement.classList.remove("order-open");
    document.removeEventListener("keydown", trapKeydown, true);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    else if (!bar.hidden) bar.focus();
  }

  /* ---------- init ---------- */
  function init() {
    loadCart();
    renderGrid();
    renderBar();
  }

  fetch(PRODUCTS_URL)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      var mapped = data && adoptApiProducts(data.products || []);
      if (!mapped || !mapped.length) throw new Error("empty catalog");
      PRODUCTS = mapped;
      init();
    })
    .catch(function (err) {
      console.info("Shop: live catalog unavailable, rendering embedded fallback.", err);
      init();
    });
})();