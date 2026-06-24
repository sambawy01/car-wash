/* Service info cards — Aqua Blue
   Progressive enhancement over the booking links: clicking a service row
   opens an info card; "Book Now" carries the row's original booking URL
   (service slug + lang intact). If this script fails, rows stay plain links. */
(() => {
  "use strict";

  const COPY = {
    "interior-exterior-wash": {
      "en": {
        "title": "Interior & Exterior Wash",
        "sub": "Full valet — inside and out",
        "body": "A complete valet that treats your car inside and out. We start with a foam bath and hand wash of the exterior, then move inside for a thorough vacuum, dashboard and door panel cleaning, and window polishing. Your car leaves looking, feeling, and smelling fresh — the kind of clean that turns heads in El Gouna.",
        "detail": "60–75 min · E£320–370"
      },
      "ar": {
        "title": "غسيل داخلي وخارجي",
        "sub": "تنظيف شامل — من الداخل والخارج",
        "body": "تنظيف شامل لسيارتك من الداخل والخارج. نبدأ بحمام الرغوة والغسيل اليدوي لل exterior، ثم ننتقل للداخل لتنظيف شامل بالمكنسة الكهربائية، وتنظيف لوحة القيادة وأبواب السيارة، وتلميع النوافذ. سيارتك تخرج نظيفة ومنعشة — النوع من النظافة الذي يلفت الأنظار في الجونة.",
        "detail": "60–75 دقيقة · E£320–370"
      }
    },
    "wheel-cleaning": {
      "en": {
        "title": "Wheel Cleaning",
        "sub": "Alloys, tires, and arches",
        "body": "Your wheels take the brunt of every journey. We deep-clean alloy rims, tires, and wheel arches with dedicated products that lift brake dust and road grime without damaging the finish. A tyre dressing completes the look — dark, rich, and showroom-fresh.",
        "detail": "30 min · E£140"
      },
      "ar": {
        "title": "تنظيف الجنوط",
        "sub": "الجنوط، الإطارات، والأقواس",
        "body": "عجلاتك تتحمل عبء كل رحلة. نقوم بتنظيف عميق لجنوط الألمنيوم، والإطارات، وأقواس العجلات بمنتجات مخصصة تزيل غبار الفرامل والأوساخ دون الإضرار بالطلاء. ينتهي العمل بتلميع الإطارات لملمع داكن وغني ولامع كالمعرض.",
        "detail": "30 دقيقة · E£140"
      }
    },
    "engine-cleaning": {
      "en": {
        "title": "Engine Cleaning",
        "sub": "Safe degreasing and dressing",
        "body": "A clean engine bay isn't just about pride — it helps you spot leaks early and keeps components in better condition. We use safe, low-pressure degreasers that lift oil and grime without forcing water into sensitive electronics, then dress the plastics for a clean, factory-fresh look.",
        "detail": "30 min · E£230"
      },
      "ar": {
        "title": "تنظيف المحرك",
        "sub": "إزالة الشحوم بأمان وتلميع",
        "body": "حجرة محرك نظيفة ليست مجرد فخر — بل تساعدك على اكتشاف التسريبات مبكراً والحفاظ على المكونات في حالة أفضل. نستخدم مزيلات شحوم آمنة ذات ضغط منخفض ترفع الزيت والأوساخ دون دفع الماء إلى الإلكترونيات الحساسة، ثم نلمع البلاستيك لمظهر نظيف كالمصنع.",
        "detail": "30 دقيقة · E£230"
      }
    },
    "polishing-protection": {
      "en": {
        "title": "Polishing & Protection",
        "sub": "Machine polish + protective wax",
        "body": "The treatment that makes your paint sing. We start with a decontamination wash, then machine-polish to remove fine swirls and oxidation, and finish with a protective wax coating that beads water for weeks. Your car's colour returns deeper, richer, and glossier than the day you bought it.",
        "detail": "90 min · E£700"
      },
      "ar": {
        "title": "تلميع وحماية الطلاء",
        "sub": "تلميع بالماكينة + شمع حماية",
        "body": "العلاج الذي يجعل طلاء سيارتك يغني. نبدأ بغسيل إزالة التلوث، ثم التلميع بالماكينة لإزالة الخدوش الدقيقة والأكسدة، وننهي بطبقة شمع حماية تصد الماء لأسابيع. يعود لون سيارتك أعمق وأغنى ولامعاً أكثر من اليوم الذي اشتريتها فيه.",
        "detail": "90 دقيقة · E£700"
      }
    },
    "steam-cleaning": {
      "en": {
        "title": "Steam Cleaning",
        "sub": "Sanitizing steam for interior",
        "body": "High-temperature steam that sanitises as it cleans — reaching deep into upholstery fibres, air vents, and crevices that a vacuum can't touch. Perfect for allergy sufferers, families with young children, or anyone who wants their interior truly hygienic. Eco-friendly and chemical-free.",
        "detail": "60 min · E£330"
      },
      "ar": {
        "title": "تنظيف وتعقيم بالبخار",
        "sub": "بخار معقم للداخل",
        "body": "بخار درجة حرارة عالية يعقم أثناء التنظيف — يصل عميقاً إلى أليف المقاعد وفتحات التهوية والزوايا التي لا تصل إليها المكنسة. مثالي لمرضى الحساسية، العائلات مع أطفال صغار، أو أي شخص يريد داخل سيارته نظيفاً تماماً. صديق للبيئة وخالٍ من المواد الكيميائية.",
        "detail": "60 دقيقة · E£330"
      }
    },
    "waterless-wash": {
      "en": {
        "title": "Waterless Wash",
        "sub": "Eco-friendly spray wash",
        "body": "The eco-conscious choice. Premium waterless wash products lift dirt from your paint and leave a protective shine — all without a single drop of water. Ideal for water-restricted areas, quick touch-ups, or when you simply want to save 150 litres per wash. Same glossy result, a fraction of the footprint.",
        "detail": "45 min · E£220"
      },
      "ar": {
        "title": "غسيل بدون مياه",
        "sub": "غسيل صديق للبيئة بالبخاخ",
        "body": "الخيار الواعي بالبيئة. منتجات غسيل بدون مياه فاخرة ترفع الأوساخ من طلاء سيارتك وتترك لمعان واقٍ — كل ذلك دون قطرة ماء واحدة. مثالي للمناطق ذات المياه المحدودة، أو اللمسات السريعة، أو عندما تريد ببساطة توفير 150 لتر لكل غسلة. نفس النتيجة اللامعة، بجزء صغير من البصمة البيئية.",
        "detail": "45 دقيقة · E£220"
      }
    }
  };

  const LANG = (document.documentElement.lang || "en").toLowerCase().indexOf("ar") === 0 ? "ar" : "en";
  const BOOK_URL = "https://book.eliteecocarwash.com/book";

  // ---- Build info card DOM (created once, reused) ----
  const card = document.createElement("div");
  card.className = "t-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.hidden = true;

  const cardInner = document.createElement("div");
  cardInner.className = "t-card-inner";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "t-card-close";
  closeBtn.setAttribute("aria-label", LANG === "ar" ? "إغلاق" : "Close");
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const cardTitle = document.createElement("h3");
  cardTitle.className = "t-card-title";
  const cardSub = document.createElement("p");
  cardSub.className = "t-card-sub";
  const cardBody = document.createElement("p");
  cardBody.className = "t-card-body";
  const cardDetail = document.createElement("p");
  cardDetail.className = "t-card-detail";
  const cardCta = document.createElement("a");
  cardCta.className = "cta cta-solid t-card-cta";

  cardInner.append(closeBtn, cardTitle, cardSub, cardBody, cardDetail, cardCta);
  card.appendChild(cardInner);
  document.body.appendChild(card);

  // ---- Open/close ----
  function openCard(slug) {
    const c = COPY[slug];
    if (!c) return;
    const lang = c[LANG];
    cardTitle.textContent = lang.title;
    cardSub.textContent = lang.sub;
    cardBody.textContent = lang.body;
    cardDetail.textContent = lang.detail;
    cardCta.href = BOOK_URL + "?service=" + slug + (LANG === "ar" ? "&lang=ar" : "");
    cardCta.textContent = LANG === "ar" ? "احجز الآن" : "Book Now";
    card.hidden = false;
    document.body.style.overflow = "hidden";
    closeBtn.focus();
  }

  function closeCard() {
    card.hidden = true;
    document.body.style.overflow = "";
  }

  closeBtn.addEventListener("click", closeCard);
  card.addEventListener("click", (e) => { if (e.target === card) closeCard(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !card.hidden) closeCard(); });

  // ---- Attach to treatment rows ----
  document.querySelectorAll(".t-row").forEach((row) => {
    const link = row.querySelector(".t-link");
    if (!link) return;
    let slug = null;
    try { slug = new URL(link.href).searchParams.get("service"); } catch (_) {}
    if (!slug || !COPY[slug]) return;

    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // let the link work normally
      e.preventDefault();
      openCard(slug);
    });
  });
})();