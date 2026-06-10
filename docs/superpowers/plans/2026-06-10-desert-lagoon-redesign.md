# Desert Lagoon Cinematic Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Victoria Vasilyeva Holistic Beauty one-page site as a cinematic luxury experience (Desert Lagoon palette: sand/teal/bronze) with GSAP scroll choreography, curated photography, and a WhatsApp booking CTA.

**Architecture:** Three hand-written files — `index.html` (semantic markup + all content), `styles.css` (design system, no framework), `main.js` (Lenis smooth scroll + GSAP ScrollTrigger choreography with a full reduced-motion fallback). Photos are downloaded locally as WebP via Unsplash's image CDN params. No build step; deploys to GitHub Pages unchanged.

**Tech Stack:** Vanilla HTML/CSS/JS · GSAP 3 + ScrollTrigger (CDN) · Lenis (CDN) · Google Fonts (Fraunces, Jost) · Unsplash photos (local WebP)

**Spec:** `docs/superpowers/specs/2026-06-10-holistic-redesign-design.md`

**Verification tooling note:** The compiled gstack browse binary cannot spawn `bun` on this machine. Always invoke browse like this:

```bash
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
B() { bun run /Users/bistrocloud/.claude/skills/gstack/browse/src/cli.ts "$@"; }
B goto "file:///Users/bistrocloud/Documents/holistic/Holistic-Beauty-Website-/index.html"
```

**Repo root for all paths below:** `/Users/bistrocloud/Documents/holistic/Holistic-Beauty-Website-`

---

## Content To Carry Over (verbatim — single source of truth)

Intro: "Holistic facial and body treatments in El Gouna, Egypt. Combining medical-grade techniques with mindful, restorative care — so your skin doesn't just look renewed, it feels it."

Services (name · detail — price/duration):
1. Facial Massage · Plastic / Myofascial / Buccal — £1,900 60m · £2,800 90m
2. Medical Body Massage — £2,100 40m · £2,800 60m
3. Microcurrent / RF Therapy — £900 20m
4. HydroFacial + Ultrasonic Cleaning · Onmacabim — £3,100 60–90m
5. Clear Skin with HOLY LAND · Fruit Peel & Hydro Mask — £1,500
6. Non-Invasive Carboxytherapy — £1,100 30m
7. Mandelic Onmacabim Peel · All-Season Lifting — £1,400 20m
8. Alginate Mask — £900
Derma Pen · Microneedling group:
9. Full Face + Neck + Décolletage — £3,800
10. Full Face + Neck — £2,800
11. Single Area — £2,100

Testimonial: "Every session with Victoria feels like a reset for both my skin and my mind. My face looks lifted and rested — people keep asking what I've changed." — A happy client — El Gouna

Stat: 10+ Years of holistic skin & body care
Contact: El Gouna, Egypt · WhatsApp +20 000 000 0000 (`https://wa.me/200000000000`) · hello@victoriavasilyeva.com
Footer: © 2026 Victoria Vasilyeva — Holistic Beauty · El Gouna · Egypt

---

### Task 1: Photo assets

**Files:**
- Create: `assets/img/hero.webp`, `assets/img/philosophy.webp`, `assets/img/setting.webp`, `assets/img/treat-face.webp`, `assets/img/treat-body.webp`, `assets/img/treat-derma.webp`

- [ ] **Step 1: Download candidates as WebP via Unsplash CDN params**

```bash
cd /Users/bistrocloud/Documents/holistic/Holistic-Beauty-Website-
mkdir -p assets/img
# hero: turquoise sea / sand, golden light
curl -sL "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=72&fm=webp&fit=crop" -o assets/img/hero.webp
# philosophy: spa still-life / stones
curl -sL "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1100&q=72&fm=webp&fit=crop" -o assets/img/philosophy.webp
# setting: wide calm water
curl -sL "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1920&q=72&fm=webp&fit=crop" -o assets/img/setting.webp
# treatment hover photos
curl -sL "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=900&q=70&fm=webp&fit=crop" -o assets/img/treat-face.webp
curl -sL "https://images.unsplash.com/photo-1600334129128-685c5582fd35?w=900&q=70&fm=webp&fit=crop" -o assets/img/treat-body.webp
curl -sL "https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=900&q=70&fm=webp&fit=crop" -o assets/img/treat-derma.webp
ls -la assets/img/
```
Expected: six files, each > 20KB, total < 900KB.

- [ ] **Step 2: Visually verify each image fits the brand**

Use the Read tool on each `assets/img/*.webp`. Check: hero = sea/sand golden tones; philosophy = spa texture; setting = calm wide water; treat-* = spa treatment scenes. If any image is off-brand (wrong subject, cold tones), replace it: search unsplash.com for "red sea lagoon", "spa stones", "facial treatment", copy the photo's `images.unsplash.com/photo-...` URL with the same query params, re-download, re-verify.

- [ ] **Step 3: Enforce budget**

```bash
du -ch assets/img/*.webp | tail -1
```
Expected: total ≤ 900K. If over: re-download largest with `q=60`.

- [ ] **Step 4: Commit**

```bash
git add assets/img && git commit -m "feat: add curated Desert Lagoon photography (WebP, local)"
```

---

### Task 2: index.html — full markup

**Files:**
- Modify: `index.html` (complete rewrite)

- [ ] **Step 1: Replace index.html entirely with:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Victoria Vasilyeva — Holistic Beauty | El Gouna, Egypt</title>
  <meta name="description" content="Private holistic beauty studio in El Gouna, Egypt. Medical-grade facial massage, HydroFacial, peels, microneedling and body treatments by Victoria Vasilyeva." />
  <meta property="og:title" content="Victoria Vasilyeva — Holistic Beauty" />
  <meta property="og:description" content="Medical-grade artistry. Red Sea calm. Private holistic beauty studio in El Gouna." />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="assets/img/hero.webp" />
  <meta name="theme-color" content="#0D2E31" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300;1,9..144,400&family=Jost:wght@300;400;500&display=swap" rel="stylesheet" />
  <link rel="preload" as="image" href="assets/img/hero.webp" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>

  <!-- Nav: hidden during hero, fades in after -->
  <nav class="nav" id="nav" aria-label="Primary">
    <a class="nav-brand" href="#hero">VV</a>
    <div class="nav-links">
      <a href="#treatments">Treatments</a>
      <a href="#about">About</a>
      <a class="nav-cta" href="https://wa.me/200000000000?text=Hello%20Victoria%2C%20I%27d%20like%20to%20reserve%20a%20treatment.">Reserve</a>
    </div>
  </nav>

  <main>
    <!-- ============ 1 · HERO — "Arrival" ============ -->
    <section class="hero" id="hero">
      <div class="hero-media" aria-hidden="true">
        <img src="assets/img/hero.webp" alt="" fetchpriority="high" />
        <div class="hero-wash"></div>
        <div class="grain"></div>
      </div>
      <div class="hero-content">
        <h1 class="hero-name" id="heroName">Victoria&nbsp;Vasilyeva</h1>
        <p class="hero-sub reveal-soft">HOLISTIC BEAUTY · EL GOUNA</p>
        <p class="hero-line reveal-soft">Medical-grade artistry. Red Sea calm.</p>
        <a class="cta reveal-soft" href="https://wa.me/200000000000?text=Hello%20Victoria%2C%20I%27d%20like%20to%20reserve%20a%20treatment.">Reserve Your Treatment</a>
      </div>
      <div class="scroll-cue" aria-hidden="true"><span></span></div>
    </section>

    <!-- ============ 2 · PHILOSOPHY — "The Approach" ============ -->
    <section class="philosophy section-light" id="about">
      <div class="wrap split-2">
        <div>
          <p class="label reveal">The Approach</p>
          <h2 class="reveal">Where medical-grade precision meets mindful restoration.</h2>
          <p class="body-copy reveal">Holistic facial and body treatments in El Gouna, Egypt. Combining medical-grade techniques with mindful, restorative care — so your skin doesn't just look renewed, it feels it.</p>
        </div>
        <figure class="photo-portrait img-reveal">
          <img src="assets/img/philosophy.webp" alt="Spa still life — warm stones and soft light" loading="lazy" />
        </figure>
      </div>
    </section>

    <!-- ============ 3 · TREATMENTS ============ -->
    <section class="treatments section-light" id="treatments">
      <div class="wrap">
        <p class="label reveal">Signature Treatments</p>
        <h2 class="reveal">The menu</h2>
        <ul class="t-list">
          <li class="t-row" data-photo="assets/img/treat-face.webp">
            <span class="t-name">Facial Massage <em>Plastic / Myofascial / Buccal</em></span>
            <span class="t-price">£1,900 <small>60m</small> · £2,800 <small>90m</small></span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-body.webp">
            <span class="t-name">Medical Body Massage</span>
            <span class="t-price">£2,100 <small>40m</small> · £2,800 <small>60m</small></span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-face.webp">
            <span class="t-name">Microcurrent / RF Therapy</span>
            <span class="t-price">£900 <small>20m</small></span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-face.webp">
            <span class="t-name">HydroFacial + Ultrasonic Cleaning <em>Onmacabim</em></span>
            <span class="t-price">£3,100 <small>60–90m</small></span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-face.webp">
            <span class="t-name">Clear Skin with HOLY LAND <em>Fruit Peel &amp; Hydro Mask</em></span>
            <span class="t-price">£1,500</span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-body.webp">
            <span class="t-name">Non-Invasive Carboxytherapy</span>
            <span class="t-price">£1,100 <small>30m</small></span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-face.webp">
            <span class="t-name">Mandelic Onmacabim Peel <em>All-Season Lifting</em></span>
            <span class="t-price">£1,400 <small>20m</small></span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-face.webp">
            <span class="t-name">Alginate Mask</span>
            <span class="t-price">£900</span>
          </li>
        </ul>
        <p class="label t-group reveal">Derma Pen · Microneedling</p>
        <ul class="t-list">
          <li class="t-row" data-photo="assets/img/treat-derma.webp">
            <span class="t-name">Full Face + Neck + Décolletage</span>
            <span class="t-price">£3,800</span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-derma.webp">
            <span class="t-name">Full Face + Neck</span>
            <span class="t-price">£2,800</span>
          </li>
          <li class="t-row" data-photo="assets/img/treat-derma.webp">
            <span class="t-name">Single Area</span>
            <span class="t-price">£2,100</span>
          </li>
        </ul>
        <div class="t-photo" id="tPhoto" aria-hidden="true"><img alt="" /></div>
      </div>
    </section>

    <!-- ============ 4 · THE SETTING ============ -->
    <section class="setting section-dark" id="setting">
      <div class="setting-media" aria-hidden="true">
        <img src="assets/img/setting.webp" alt="" loading="lazy" />
        <div class="setting-wash"></div>
        <div class="grain"></div>
      </div>
      <div class="wrap setting-content">
        <p class="label reveal">The Setting</p>
        <p class="setting-stat reveal"><span class="stat-num">10+</span> years of holistic skin &amp; body care</p>
        <p class="setting-place reveal">A private studio on the lagoons of El Gouna, Red Sea, Egypt.</p>
      </div>
    </section>

    <!-- ============ 5 · IN HER WORDS ============ -->
    <section class="voice section-light">
      <div class="wrap">
        <p class="label reveal">In Her Words</p>
        <blockquote class="reveal">
          <p>"Every session with Victoria feels like a reset for both my skin and my mind. My face looks lifted and rested — people keep asking what I've changed."</p>
          <cite>A happy client — El Gouna</cite>
        </blockquote>
      </div>
    </section>

    <!-- ============ 6 · RESERVE — "Begin" ============ -->
    <section class="reserve section-dark" id="reserve">
      <div class="wrap reserve-content">
        <img class="reserve-logo reveal" src="assets/logo-white.png" alt="Victoria Vasilyeva — Holistic Beauty" />
        <p class="reserve-line reveal">Your skin remembers how you treat it.</p>
        <a class="cta cta-solid reveal" href="https://wa.me/200000000000?text=Hello%20Victoria%2C%20I%27d%20like%20to%20reserve%20a%20treatment.">Reserve on WhatsApp</a>
        <address class="reserve-meta reveal">
          El Gouna, Egypt · WhatsApp +20 000 000 0000 · <a href="mailto:hello@victoriavasilyeva.com">hello@victoriavasilyeva.com</a>
        </address>
      </div>
      <footer class="footer">
        <span>© 2026 Victoria Vasilyeva — Holistic Beauty</span>
        <span>El Gouna · Egypt</span>
      </footer>
    </section>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/lenis@1.1.14/dist/lenis.min.js" defer></script>
  <script src="main.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: Sanity-check in browser (will be unstyled)**

```bash
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
B() { bun run /Users/bistrocloud/.claude/skills/gstack/browse/src/cli.ts "$@"; }
B goto "file:///Users/bistrocloud/Documents/holistic/Holistic-Beauty-Website-/index.html"
B console --errors
B text | head -40
```
Expected: console shows only a 404 for `styles.css`/`main.js` (not yet created) at most; text contains all 11 treatment names and both placeholder contacts.

- [ ] **Step 3: Commit**

```bash
git add index.html && git commit -m "feat: semantic one-page markup for Desert Lagoon redesign"
```

---

### Task 3: styles.css — design system

**Files:**
- Create: `styles.css`

- [ ] **Step 1: Create styles.css with:**

```css
/* ===== Desert Lagoon design system ===== */
:root {
  --sand: #EDE3D3;
  --sand-deep: #D9C4A0;
  --teal: #16494E;
  --teal-dark: #0D2E31;
  --bronze: #B08D57;
  --ink: #2B2620;
  --serif: "Fraunces", "Cormorant Garamond", Georgia, serif;
  --sans: "Jost", "Inter", system-ui, sans-serif;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: var(--sans);
  font-weight: 300;
  background: var(--sand);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
img { display: block; max-width: 100%; }
a { color: inherit; text-decoration: none; }

.wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
.label {
  font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase;
  color: var(--bronze); margin-bottom: 18px;
}
h2 {
  font-family: var(--serif); font-weight: 300; font-size: clamp(30px, 4.5vw, 52px);
  line-height: 1.12; letter-spacing: -0.01em; max-width: 16em;
}
.body-copy { font-size: 17px; line-height: 1.75; max-width: 34em; margin-top: 22px; color: rgba(43,38,32,0.78); }

.section-light { background: var(--sand); color: var(--ink); padding: clamp(90px, 14vh, 160px) 0; }
.section-dark  { background: var(--teal-dark); color: var(--sand); }
.section-dark .label { color: var(--sand-deep); }

/* ===== Grain ===== */
.grain {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.5; mix-blend-mode: soft-light;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  background-size: 240px 240px;
}

/* ===== Nav ===== */
.nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 50;
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 28px;
  opacity: 0; pointer-events: none; transform: translateY(-8px);
  transition: opacity 0.5s var(--ease), transform 0.5s var(--ease);
  background: linear-gradient(rgba(13,46,49,0.55), transparent);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  color: var(--sand);
}
.nav.visible { opacity: 1; pointer-events: auto; transform: none; }
.nav-brand { font-family: var(--serif); font-style: italic; font-size: 22px; }
.nav-links { display: flex; gap: 28px; align-items: center; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; }
.nav-links a { opacity: 0.85; transition: opacity 0.3s; }
.nav-links a:hover { opacity: 1; }
.nav-cta { border: 1px solid var(--bronze); border-radius: 999px; padding: 8px 18px; color: var(--sand-deep); }

/* ===== Hero ===== */
.hero { position: relative; min-height: 100svh; display: grid; place-items: center; overflow: hidden; color: var(--sand); }
.hero-media { position: absolute; inset: 0; }
.hero-media img {
  width: 100%; height: 100%; object-fit: cover;
  animation: kenburns 30s var(--ease) infinite alternate;
}
@keyframes kenburns { from { transform: scale(1) translateY(0); } to { transform: scale(1.08) translateY(-1.5%); } }
.hero-wash {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(13,46,49,0.45) 0%, rgba(22,73,78,0.35) 45%, rgba(13,46,49,0.82) 100%);
}
.hero-content { position: relative; z-index: 2; text-align: center; padding: 0 20px; }
.hero-name {
  font-family: var(--serif); font-style: italic; font-weight: 300;
  font-size: clamp(44px, 9vw, 110px); line-height: 1.05; letter-spacing: 0.01em;
  text-shadow: 0 2px 30px rgba(13,46,49,0.45);
}
.hero-name .ch { display: inline-block; will-change: transform, opacity; }
.hero-sub { margin-top: 18px; font-size: 12px; letter-spacing: 0.5em; text-indent: 0.5em; color: var(--sand-deep); }
.hero-line { margin-top: 26px; font-family: var(--serif); font-size: clamp(17px, 2.2vw, 22px); color: rgba(237,227,211,0.92); }
.cta {
  display: inline-block; margin-top: 38px; padding: 16px 38px;
  border: 1px solid var(--bronze); border-radius: 999px;
  font-size: 13px; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--sand); position: relative; overflow: hidden;
  transition: border-color 0.4s, color 0.4s;
}
.cta::after {  /* shimmer sweep */
  content: ""; position: absolute; top: 0; bottom: 0; width: 60%; left: -80%;
  background: linear-gradient(105deg, transparent, rgba(176,141,87,0.35), transparent);
  transform: skewX(-18deg); transition: left 0.7s var(--ease);
}
.cta:hover::after { left: 120%; }
.cta:hover { border-color: var(--sand-deep); }
.cta-solid { background: var(--bronze); border-color: var(--bronze); color: #fff; }
.scroll-cue { position: absolute; bottom: 34px; left: 50%; transform: translateX(-50%); z-index: 2; }
.scroll-cue span {
  display: block; width: 1px; height: 64px; background: var(--sand-deep);
  transform-origin: top; animation: cue 2.4s var(--ease) infinite;
}
@keyframes cue { 0% { transform: scaleY(0); } 55% { transform: scaleY(1); transform-origin: top; } 56% { transform-origin: bottom; } 100% { transform: scaleY(0); transform-origin: bottom; } }

/* ===== Philosophy ===== */
.split-2 { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: clamp(40px, 6vw, 90px); align-items: center; }
.photo-portrait { aspect-ratio: 3 / 4; overflow: hidden; border-radius: 2px; }
.photo-portrait img { width: 100%; height: 100%; object-fit: cover; filter: sepia(0.12) saturate(0.92) contrast(1.02); }
@media (max-width: 820px) { .split-2 { grid-template-columns: 1fr; } .photo-portrait { order: -1; max-width: 420px; } }

/* ===== Treatments ===== */
.treatments .wrap { position: relative; }
.t-list { list-style: none; margin-top: 40px; }
.t-group { margin-top: 56px; }
.t-row {
  display: flex; justify-content: space-between; align-items: baseline; gap: 24px;
  padding: 22px 4px; border-bottom: 1px solid rgba(43,38,32,0.14);
  position: relative; cursor: default;
}
.t-name { font-family: var(--serif); font-size: clamp(18px, 2.4vw, 24px); }
.t-name em { font-style: normal; font-family: var(--sans); font-size: 13px; color: rgba(43,38,32,0.55); margin-left: 10px; letter-spacing: 0.04em; }
.t-price { flex: none; color: var(--bronze); font-size: 15px; letter-spacing: 0.05em; }
.t-price small { color: rgba(43,38,32,0.45); font-size: 12px; }
.t-photo {
  position: fixed; z-index: 30; width: 230px; aspect-ratio: 4/5; pointer-events: none;
  opacity: 0; clip-path: inset(0 0 100% 0); transition: clip-path 0.55s var(--ease), opacity 0.3s;
  display: none;
}
.t-photo img { width: 100%; height: 100%; object-fit: cover; filter: sepia(0.12) saturate(0.92); }
@media (hover: hover) and (min-width: 900px) {
  .t-photo { display: block; }
  .t-row:hover .t-name { color: var(--teal); }
}

/* ===== Setting ===== */
.setting { position: relative; min-height: 80svh; display: grid; align-items: end; overflow: hidden; }
.setting-media { position: absolute; inset: -12% 0; }
.setting-media img { width: 100%; height: 100%; object-fit: cover; will-change: transform; }
.setting-wash { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(13,46,49,0.7), rgba(13,46,49,0.35) 50%, rgba(13,46,49,0.85)); }
.setting-content { position: relative; z-index: 2; padding-top: 18vh; padding-bottom: 12vh; }
.setting-stat { font-family: var(--serif); font-size: clamp(26px, 3.6vw, 40px); max-width: 18em; }
.stat-num { font-size: clamp(64px, 10vw, 130px); font-style: italic; line-height: 1; display: block; color: var(--sand-deep); }
.setting-place { margin-top: 22px; font-size: 15px; color: rgba(237,227,211,0.75); }

/* ===== Voice ===== */
.voice blockquote p { font-family: var(--serif); font-style: italic; font-size: clamp(24px, 3.4vw, 40px); line-height: 1.35; max-width: 24em; }
.voice cite { display: block; margin-top: 28px; font-style: normal; font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--bronze); }

/* ===== Reserve ===== */
.reserve { padding: clamp(100px, 16vh, 180px) 0 0; text-align: center; }
.reserve-logo { width: min(340px, 70vw); margin: 0 auto; }
.reserve-line { margin-top: 30px; font-family: var(--serif); font-style: italic; font-size: clamp(18px, 2.4vw, 24px); color: var(--sand-deep); }
.reserve-meta { margin-top: 34px; font-style: normal; font-size: 14px; color: rgba(237,227,211,0.65); }
.reserve-meta a:hover { color: var(--sand-deep); }
.footer {
  margin-top: clamp(70px, 10vh, 120px); padding: 22px 28px;
  display: flex; justify-content: space-between;
  font-size: 11px; color: rgba(237,227,211,0.4);
  border-top: 1px solid rgba(237,227,211,0.12);
}

/* ===== Animation initial states (JS removes) ===== */
.js .reveal, .js .reveal-soft { opacity: 0; transform: translateY(28px); }
.js .img-reveal img { transform: scale(1.08); }
.js .hero-name { opacity: 0; }

/* ===== Reduced motion ===== */
@media (prefers-reduced-motion: reduce) {
  .hero-media img, .scroll-cue span, .cta::after { animation: none !important; transition: none !important; }
  .js .reveal, .js .reveal-soft, .js .hero-name { opacity: 1 !important; transform: none !important; }
  .js .img-reveal img { transform: none !important; }
  html { scroll-behavior: auto; }
}
```

- [ ] **Step 2: Visual check**

```bash
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
B() { bun run /Users/bistrocloud/.claude/skills/gstack/browse/src/cli.ts "$@"; }
B reload
B console --errors
B screenshot /tmp/dl-css-desktop.png
```
Read `/tmp/dl-css-desktop.png`. Expected: styled hero with photo + centered serif name (static — JS not yet present), sand sections beneath. Only remaining console 404: `main.js`.

- [ ] **Step 3: Commit**

```bash
git add styles.css && git commit -m "feat: Desert Lagoon design system CSS"
```

---

### Task 4: main.js — motion choreography

**Files:**
- Create: `main.js`

- [ ] **Step 1: Create main.js with:**

```js
/* Desert Lagoon — motion choreography
   Progressive enhancement: page is fully readable with JS off or reduced motion. */
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nav = document.getElementById("nav");

  // Nav visibility works in all modes
  const hero = document.getElementById("hero");
  const navObserver = new IntersectionObserver(
    ([e]) => nav.classList.toggle("visible", !e.isIntersecting),
    { threshold: 0.08 }
  );
  navObserver.observe(hero);

  if (reduced || !window.gsap) return; // static experience

  document.documentElement.classList.add("js");
  gsap.registerPlugin(ScrollTrigger);

  // ---- Smooth scroll (Lenis) ----
  const lenis = new Lenis({ lerp: 0.09 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  // ---- Hero load sequence ----
  const name = document.getElementById("heroName");
  name.innerHTML = name.textContent
    .split("")
    .map((c) => (c.trim() === "" ? " " : `<span class="ch">${c}</span>`))
    .join("");
  gsap.set(name, { opacity: 1 });
  gsap.timeline()
    .from(".hero-name .ch", { yPercent: 60, opacity: 0, duration: 0.9, stagger: 0.035, ease: "power3.out" }, 0.15)
    .to(".hero .reveal-soft", { opacity: 1, y: 0, duration: 0.8, stagger: 0.12, ease: "power2.out" }, "-=0.45");

  // ---- Hero parallax scroll-out ----
  gsap.to(".hero-media", {
    yPercent: 18, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true },
  });
  gsap.to(".hero-content", {
    yPercent: -28, opacity: 0, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "70% top", scrub: true },
  });

  // ---- Generic reveals ----
  document.querySelectorAll("main .reveal:not(.hero .reveal)").forEach((el) => {
    gsap.to(el, {
      opacity: 1, y: 0, duration: 1, ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 84%" },
    });
  });

  // ---- Image entrances ----
  document.querySelectorAll(".img-reveal img").forEach((img) => {
    gsap.to(img, {
      scale: 1, duration: 1.4, ease: "power2.out",
      scrollTrigger: { trigger: img, start: "top 85%" },
    });
  });

  // ---- Treatments cascade ----
  gsap.utils.toArray(".t-list").forEach((list) => {
    gsap.from(list.querySelectorAll(".t-row"), {
      opacity: 0, y: 24, duration: 0.7, stagger: 0.07, ease: "power2.out",
      scrollTrigger: { trigger: list, start: "top 82%" },
    });
  });

  // ---- Treatment hover photo (desktop pointer only) ----
  const tPhoto = document.getElementById("tPhoto");
  if (tPhoto && window.matchMedia("(hover: hover) and (min-width: 900px)").matches) {
    const img = tPhoto.querySelector("img");
    document.querySelectorAll(".t-row").forEach((row) => {
      row.addEventListener("mouseenter", () => {
        img.src = row.dataset.photo;
        tPhoto.style.opacity = "1";
        tPhoto.style.clipPath = "inset(0 0 0% 0)";
      });
      row.addEventListener("mouseleave", () => {
        tPhoto.style.opacity = "0";
        tPhoto.style.clipPath = "inset(0 0 100% 0)";
      });
      row.addEventListener("mousemove", (e) => {
        tPhoto.style.left = Math.min(e.clientX + 28, window.innerWidth - 260) + "px";
        tPhoto.style.top = e.clientY - 140 + "px";
      });
    });
  }

  // ---- Setting parallax (water rising) ----
  gsap.fromTo(".setting-media img",
    { yPercent: -10 }, {
      yPercent: 10, ease: "none",
      scrollTrigger: { trigger: ".setting", start: "top bottom", end: "bottom top", scrub: true },
    });

  // ---- Anchor links through Lenis ----
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (target) { e.preventDefault(); lenis.scrollTo(target, { offset: 0 }); }
    });
  });
})();
```

- [ ] **Step 2: Add the `js` class guard** — `main.js` adds `.js` to `<html>` only when GSAP runs, so initial-state CSS (`.js .reveal {...}`) never hides content for no-JS/reduced-motion users. Verify this ordering is correct in the file above (classList.add **after** the reduced/gsap guard). No code change expected — this is a review step.

- [ ] **Step 3: Full check in browser**

```bash
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
B() { bun run /Users/bistrocloud/.claude/skills/gstack/browse/src/cli.ts "$@"; }
B reload
B console
B screenshot /tmp/dl-hero.png
B js "window.scrollTo(0, document.body.scrollHeight/2)"
B screenshot /tmp/dl-mid.png
B js "window.scrollTo(0, document.body.scrollHeight)"
B screenshot /tmp/dl-end.png
```
Read all three PNGs. Expected: hero with revealed name; treatments rows visible at mid-page; dark Reserve section with logo + bronze CTA at end. Console: zero errors (CDN warnings about Tailwind must be gone).

- [ ] **Step 4: Commit**

```bash
git add main.js && git commit -m "feat: GSAP/Lenis cinematic motion system with reduced-motion fallback"
```

---

### Task 5: Responsive + interaction verification (fix loop)

**Files:**
- Modify: `index.html` / `styles.css` / `main.js` as needed by findings

- [ ] **Step 1: Responsive screenshots**

```bash
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
B() { bun run /Users/bistrocloud/.claude/skills/gstack/browse/src/cli.ts "$@"; }
B goto "file:///Users/bistrocloud/Documents/holistic/Holistic-Beauty-Website-/index.html"
B responsive /tmp/dl
```
Read `/tmp/dl-mobile.png`, `/tmp/dl-tablet.png`, `/tmp/dl-desktop.png`. Check: hero name fits without wrapping awkwardly at 375px; treatment prices don't collide with names; no horizontal scroll.

- [ ] **Step 2: Interaction checks**

```bash
B viewport 1280x800
B snapshot -i | head -30        # nav + CTA links present with WhatsApp hrefs
B hover ".t-row"                # then:
B screenshot /tmp/dl-hover.png  # photo reveal visible near cursor
B is visible "#nav"             # after scrolling past hero:
B js "window.scrollTo(0, 1200)"
B js "document.getElementById('nav').classList.contains('visible')"
```
Expected: WhatsApp hrefs contain `wa.me/200000000000?text=`; hover photo appears; nav visible === true after scroll.

- [ ] **Step 3: Fix anything found, re-verify, commit**

```bash
git add -A && git commit -m "fix: responsive and interaction polish from QA pass"
```
(Skip commit if no findings.)

---

### Task 6: Performance, accessibility, final audit

- [ ] **Step 1: Page weight budget**

```bash
cd /Users/bistrocloud/Documents/holistic/Holistic-Beauty-Website-
du -ch index.html styles.css main.js assets/img/*.webp assets/logo-white.png | tail -1
```
Expected: ≤ 1.4M (leaves ~100KB headroom for CDN JS against the 1.5MB budget). If over: recompress images (`q=60`).

- [ ] **Step 2: Perf + console final**

```bash
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
B() { bun run /Users/bistrocloud/.claude/skills/gstack/browse/src/cli.ts "$@"; }
B reload
B perf
B console
```
Expected: DOMContentLoaded < 1s local; zero console errors/warnings.

- [ ] **Step 3: Accessibility sweep**

```bash
B accessibility | head -60
```
Check: single H1 (hero name); nav landmarks; all `<img>` with empty-or-real alt; contrast: bronze `#B08D57` on sand only at ≥18px (labels are uppercase + tracked, acceptable); links have accessible names.

- [ ] **Step 4: Reduced-motion spot check**

```bash
B js "matchMedia('(prefers-reduced-motion: reduce)').matches"
```
Manually verify the guard in `main.js` (`if (reduced || !window.gsap) return`) and the CSS `@media (prefers-reduced-motion: reduce)` block force-show all `.reveal` content.

- [ ] **Step 5: Update README + final commit**

In `README.md`: replace the Stack section with "Static HTML + hand-written CSS · GSAP ScrollTrigger + Lenis (CDN) · Fraunces & Jost (Google Fonts) · local WebP photography"; keep deploy + to-do sections (placeholders still pending).

```bash
git add -A && git commit -m "feat: Desert Lagoon cinematic redesign — perf, a11y, docs"
```

---

## Self-Review Notes

- **Spec coverage:** Hero "Arrival" (Task 2/4), philosophy, 11 treatments verbatim (Task 2 content block), setting w/ 10+ stat, testimonial, reserve + footer — all present. Motion system items (Lenis, char reveal, parallax, cascade, hover wipe, nav fade, scroll cue, reduced-motion) → Tasks 3/4. Photos local WebP (Task 1), budget + a11y + SEO (Task 6). Pinned "water rising" transition simplified to the setting-section parallax (kept within perf budget) — acceptable interpretation of spec's transition language.
- **Type consistency:** IDs `nav/hero/heroName/tPhoto` consistent across HTML/CSS/JS; class names `.reveal/.reveal-soft/.img-reveal/.t-row/.t-photo` consistent.
- **No placeholders:** all code complete; image URLs pre-verified HTTP 200 on 2026-06-10.
