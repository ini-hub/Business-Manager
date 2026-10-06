import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import { KowopeLogo } from "@/components/kowope-logo";
import { Bell, Check, CheckCheck, ChevronDown, ChevronRight, Menu, X } from "lucide-react";
import {
  FAQS, FOUNDING_PERKS, FOUNDING_PLACES_LEFT, FREE_PLAN, INDUSTRIES, LOGIN_PATH, NAV_LINKS, PROOF,
  REASSURANCES, ROTATE_MS, SCENES, SIGNUP_PATH, STAGES, STEPS, SWITCH_CARDS, TESTIMONIALS,
  type Scene, type Testimonial, type Tone,
} from "./landing-data";
import { priceSelection, type PublicPricing } from "@shared/bundles";
import { CATEGORY_LABELS, formatMoney, savePlanChoice, usePublicPricing } from "@/lib/pricing";
import "./landing.css";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

// Every Start free / plan button opens the sign-up form directly, keeping utm_* params.
function goToStart() {
  const utm = new URLSearchParams();
  new URLSearchParams(window.location.search).forEach((v, k) => { if (k.startsWith("utm_")) utm.append(k, v); });
  const qs = utm.toString();
  window.location.assign(qs ? `${SIGNUP_PATH}?${qs}` : SIGNUP_PATH);
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`kp-chip kp-chip--${tone}`}>{children}</span>;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="kp-eyebrow">{children}</p>;
}

// ── Header ────────────────────────────────────────────────────────────────
function Header({ onStart }: { onStart: () => void }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); menuBtn.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [open]);

  const nav = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    setOpen(false);
    // Let the sheet release the scroll lock before scrolling.
    requestAnimationFrame(() => scrollToId(id));
  };

  return (
    <header className={`kp-header${scrolled ? " is-scrolled" : ""}`}>
      <div className="kp-wrap kp-header-in">
        <a href="#top" className="kp-brand" aria-label="Kowope home" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0 }); }}>
          <KowopeLogo />
        </a>
        <nav className="kp-nav" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={nav(l.id)}>{l.label}</a>
          ))}
        </nav>
        <div className="kp-header-actions">
          <Link href={LOGIN_PATH} className="kp-login">Log in</Link>
          <button type="button" className="kp-btn kp-btn--primary kp-btn--sm kp-hide-sm" onClick={onStart}>Start free</button>
          <button
            ref={menuBtn}
            type="button"
            className="kp-menu-btn"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="kp-sheet"
            onClick={() => setOpen(true)}
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div id="kp-sheet" className={`kp-sheet${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-label="Menu" hidden={!open}>
        <div className="kp-sheet-top">
          <KowopeLogo />
          <button ref={closeBtn} type="button" className="kp-menu-btn" aria-label="Close menu" onClick={() => { setOpen(false); menuBtn.current?.focus(); }}>
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <nav className="kp-sheet-nav" aria-label="Menu">
          {NAV_LINKS.map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={nav(l.id)}>{l.label}</a>
          ))}
          <Link href={LOGIN_PATH} onClick={() => setOpen(false)}>Log in</Link>
        </nav>
        <button type="button" className="kp-btn kp-btn--primary kp-btn--lg kp-btn--block" onClick={() => { setOpen(false); requestAnimationFrame(onStart); }}>
          Start free
        </button>
      </div>
    </header>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────
function Announcement({ index, onSelect, onPause }: { index: number; onSelect: (i: number) => void; onPause: (p: boolean) => void }) {
  const active = SCENES[index];
  return (
    <div
      className="kp-announce"
      onMouseEnter={() => onPause(true)}
      onMouseLeave={() => onPause(false)}
      onFocus={() => onPause(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onPause(false); }}
    >
      <p className="kp-pill">
        {/* Hidden copies reserve the widest and tallest item so rotation never shifts layout. */}
        <span className="kp-pill-sizers" aria-hidden="true">
          {SCENES.map((s) => (
            <span key={s.key} className="kp-pill-item"><span className="kp-chip">{s.status}</span><span>{s.announcement}</span></span>
          ))}
        </span>
        <span className="kp-pill-live" aria-live="polite" aria-atomic="true">
          <span className="kp-pill-item">
            <Chip tone={active.tone}>{active.status}</Chip>
            <span>{active.announcement}</span>
          </span>
        </span>
      </p>
      <div className="kp-dots" role="group" aria-label="Announcements">
        {SCENES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className={`kp-dot${i === index ? " is-on" : ""}`}
            aria-label={`Show announcement ${i + 1} of ${SCENES.length}: ${s.announcement}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => onSelect(i)}
          />
        ))}
      </div>
    </div>
  );
}

function SceneScreen({ scene, active }: { scene: Scene; active: boolean }) {
  return (
    <div className={`kp-scene${active ? " is-on" : ""}`}>
      <div className="kp-piece kp-p1">
        <p className="kp-scr-muted">{scene.shop} · Today</p>
        <p className="kp-scr-greet">Good evening, {scene.owner}</p>
      </div>
      <div className="kp-piece kp-p2 kp-scr-hero">
        <p className="kp-scr-hero-label">{scene.hero.label}</p>
        <p className="kp-scr-hero-value">{scene.hero.value}</p>
        <p className="kp-scr-hero-sub">{scene.hero.sub}</p>
      </div>
      <div className="kp-piece kp-p3 kp-scr-tiles">
        {scene.tiles.map((t) => (
          <div key={t.label} className="kp-scr-tile">
            <p className="kp-scr-muted">{t.label}</p>
            <p className="kp-scr-tile-value">{t.value}</p>
          </div>
        ))}
      </div>
      <ul className="kp-piece kp-p4 kp-scr-list">
        {scene.rows.map((r) => (
          <li key={r.name}>
            <span>{r.name}</span>
            {r.badge ? <Chip tone={r.badge.tone}>{r.badge.text}</Chip> : <span className="kp-scr-amt">{r.amount}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotifCard({ side, scenes, index }: { side: "a" | "b"; scenes: Scene[]; index: number }) {
  return (
    <div className={`kp-cardpos kp-cardpos--${side}`}>
      <div className="kp-notif">
        {scenes.map((s, i) => {
          const c = side === "a" ? s.cardA : s.cardB;
          return (
            <div key={s.key} className={`kp-face${i === index ? " is-on" : ""}`}>
              <span className="kp-notif-icon" aria-hidden="true">{side === "a" ? <CheckCheck size={16} /> : <Bell size={16} />}</span>
              <span>
                <span className="kp-notif-title">{c.title}</span>
                <span className="kp-notif-sub">{c.sub}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Hero({ onStart }: { onStart: () => void }) {
  const [index, setIndex] = useState(0);
  const [tick, setTick] = useState(0); // bumps on manual selection so the same dot still restarts the timer
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % SCENES.length), ROTATE_MS);
    return () => window.clearTimeout(t);
  }, [index, tick, paused]);

  const select = useCallback((i: number) => { setIndex(i); setTick((n) => n + 1); }, []);

  return (
    <section className="kp-hero" id="top" aria-labelledby="kp-h1">
      <div className="kp-wrap kp-hero-grid">
        <div className="kp-hero-copy">
          <Announcement index={index} onSelect={select} onPause={setPaused} />
          <h1 id="kp-h1">Run your whole business from your phone.</h1>
          <p className="kp-lead">Sales, stock, customers, staff and bookings in one app built for Nigerian SMEs. Start free and pay only for the tools you use, in Naira.</p>
          <div className="kp-hero-btns">
            <button type="button" className="kp-btn kp-btn--primary kp-btn--lg" onClick={onStart}>Start free, no card needed</button>
            <button type="button" className="kp-btn kp-btn--secondary kp-btn--lg" onClick={() => scrollToId("how")}>See how it works in 2 minutes</button>
          </div>
          <ul className="kp-checks">
            {REASSURANCES.map((r) => (
              <li key={r}><Check size={16} aria-hidden="true" />{r}</li>
            ))}
          </ul>
        </div>
        <div className="kp-visual" aria-hidden="true">
          <div className="kp-scale">
            <div className="kp-phone">
              <div className="kp-screen">
                <span className="kp-notch" />
                {SCENES.map((s, i) => <SceneScreen key={s.key} scene={s} active={i === index} />)}
                <div className="kp-piece kp-p5 kp-newsale">+ New sale</div>
              </div>
            </div>
          </div>
          <NotifCard side="a" scenes={SCENES} index={index} />
          <NotifCard side="b" scenes={SCENES} index={index} />
        </div>
      </div>
    </section>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────
function Proof() {
  if (PROOF.length === 0) return null;
  return (
    <section className="kp-proof" aria-label="Trusted by">
      <div className="kp-wrap kp-proof-in">
        <p className="kp-eyebrow kp-eyebrow--muted">Trusted by SME owners across Nigeria</p>
        <ul>
          {PROOF.map((p) => (
            <li key={p.label}><strong>{p.value}</strong><span>{p.label}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Why() {
  return (
    <section className="kp-section kp-section--white" aria-labelledby="kp-why">
      <div className="kp-wrap">
        <Eyebrow>Why owners switch</Eyebrow>
        <h2 id="kp-why" className="kp-h2">Three things a notebook will never do for you.</h2>
        <div className="kp-grid3">
          {SWITCH_CARDS.map((c) => (
            <article key={c.title} className="kp-card kp-switch">
              <div className="kp-snippet" aria-hidden="true">
                {c.snippet.map((r) => (
                  <div key={r.name} className="kp-snippet-row"><span>{r.name}</span><Chip tone={r.tone}>{r.badge}</Chip></div>
                ))}
              </div>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section id="how" className="kp-section kp-section--page" aria-labelledby="kp-how">
      <div className="kp-wrap">
        <Eyebrow>How it works</Eyebrow>
        <h2 id="kp-how" className="kp-h2">Your first sale today.</h2>
        <ol className="kp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="kp-step">
              <span className="kp-step-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Industries() {
  return (
    <section id="industries" className="kp-section kp-section--white" aria-labelledby="kp-ind">
      <div className="kp-wrap">
        <Eyebrow>Industries</Eyebrow>
        <h2 id="kp-ind" className="kp-h2">Made for how your business works.</h2>
        <ul className="kp-industries">
          {INDUSTRIES.map((i) => (
            <li key={i.title}>
              <h3>{i.title}</h3>
              <p>{i.text}</p>
              <p className="kp-modules">{i.modules}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Pricing({ onStart }: { onStart: () => void }) {
  const { data: pricing, isError } = usePublicPricing();
  const landingBundles = (pricing?.bundles ?? []).filter((b) => b.showOnLanding);
  const currency = pricing?.currency ?? "NGN";
  const cheapest = pricing?.features.reduce((min, f) => (f.priceMonthly > 0 && f.priceMonthly < min ? f.priceMonthly : min), Infinity);

  const choose = (bundle?: string) => {
    savePlanChoice(bundle ? { bundle } : null);
    onStart();
  };

  return (
    <section id="pricing" className="kp-section kp-section--page" aria-labelledby="kp-pricing">
      <div className="kp-wrap">
        <div className="kp-pricing-head">
          <div>
            <Eyebrow>Pricing</Eyebrow>
            <h2 id="kp-pricing" className="kp-h2">Free to start. Pay for what earns you money.</h2>
          </div>
          <p className="kp-note">
            Yearly billing: 2 months free.
            {cheapest !== undefined && Number.isFinite(cheapest) && ` Single modules from ${formatMoney(cheapest, currency)}/month.`}
          </p>
        </div>
        <div className="kp-plans">
          <article className="kp-plan">
            <div className="kp-plan-head">
              <h3>{FREE_PLAN.name}</h3>
              <p className="kp-plan-tag">{FREE_PLAN.tagline}</p>
            </div>
            <p className="kp-price"><strong>{formatMoney(0, currency)}</strong></p>
            <ul className="kp-plan-features">
              {FREE_PLAN.features.map((f) => <li key={f}><Check size={16} aria-hidden="true" />{f}</li>)}
            </ul>
            <button type="button" className="kp-btn kp-plan-btn kp-btn--secondary" onClick={() => choose()}>{FREE_PLAN.cta}</button>
            <ChevronRight className="kp-plan-chev" size={20} aria-hidden="true" />
          </article>
          {landingBundles.map((b) => (
            <article key={b.key} className={`kp-plan${b.featured ? " kp-plan--featured" : ""}`}>
              {b.featured && <span className="kp-badge">Most popular</span>}
              <div className="kp-plan-head">
                <h3>{b.name}</h3>
                <p className="kp-plan-tag">{b.tagline}</p>
              </div>
              <p className="kp-price">
                {b.listMonthly > b.priceMonthly && <s className="kp-was">{formatMoney(b.listMonthly, currency)}</s>}
                <strong>{formatMoney(b.priceMonthly, currency)}</strong>
                <span>/month</span>
              </p>
              <ul className="kp-plan-features">
                {b.bullets.map((f) => <li key={f}><Check size={16} aria-hidden="true" />{f}</li>)}
                {b.discountPct > 0 && <li><Check size={16} aria-hidden="true" />Bundle saves {b.discountPct}% on these modules</li>}
              </ul>
              <button type="button" className={`kp-btn kp-plan-btn ${b.featured ? "kp-btn--primary" : "kp-btn--secondary"}`} onClick={() => choose(b.key)}>
                {b.featured && pricing ? `Try ${b.name} free for ${pricing.trialDays} days` : `Choose ${b.name}`}
              </button>
              <ChevronRight className="kp-plan-chev" size={20} aria-hidden="true" />
            </article>
          ))}
          {!pricing && !isError && <p className="kp-note" role="status">Loading plans…</p>}
          {isError && <p className="kp-note">Paid plans are shown when you sign up.</p>}
        </div>
        {pricing && pricing.features.length > 0 && <CustomPlan pricing={pricing} onStart={onStart} />}
      </div>
    </section>
  );
}

// Build-your-own: bundles are a shortcut, not a limit. Start from a bundle or
// from nothing, add or drop any module, and the total is priced by the same
// rule billing uses (priceSelection), so what you see is what you are charged.
function CustomPlan({ pricing, onStart }: { pricing: PublicPricing; onStart: () => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const featureByKey = new Map(pricing.features.map((f) => [f.key, f]));
  const price = (k: string) => featureByKey.get(k)?.priceMonthly ?? 0;
  const result = priceSelection(selected, price, pricing.bundles);
  const winner = pricing.bundles.find((b) => b.key === result.bundleKey);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // Dropping a module also drops anything that can't work without it.
        let changed = true;
        while (changed) {
          changed = false;
          next.forEach((k) => {
            if (featureByKey.get(k)?.dependsOn.some((d) => !next.has(d))) { next.delete(k); changed = true; }
          });
        }
      } else {
        const add = (k: string) => {
          if (next.has(k)) return;
          next.add(k);
          featureByKey.get(k)?.dependsOn.forEach(add);
        };
        add(key);
      }
      return next;
    });
  };

  const byCategory = pricing.features.reduce<Record<string, PublicPricing["features"]>>((acc, f) => {
    (acc[f.category] ??= []).push(f);
    return acc;
  }, {});

  const go = () => {
    savePlanChoice({ features: Array.from(selected) });
    onStart();
  };

  return (
    <div className="kp-custom">
      <div className="kp-custom-head">
        <div>
          <h3>Build your own</h3>
          <p className="kp-plan-tag">Start from a bundle or from nothing. Add or remove any module.</p>
        </div>
        <button type="button" className="kp-btn kp-btn--secondary kp-btn--sm" aria-expanded={open} aria-controls="kp-custom-body" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Choose modules"}
        </button>
      </div>
      {open && (
        <div id="kp-custom-body" className="kp-custom-body">
          <div className="kp-custom-presets" role="group" aria-label="Start from a bundle">
            {pricing.bundles.map((b) => (
              <button key={b.key} type="button" className="kp-chip-btn" onClick={() => setSelected(new Set(b.featureKeys))}>Start from {b.name}</button>
            ))}
            {selected.size > 0 && <button type="button" className="kp-chip-btn" onClick={() => setSelected(new Set())}>Clear</button>}
          </div>
          {Object.entries(byCategory).map(([cat, list]) => (
            <fieldset key={cat} className="kp-custom-group">
              <legend>{CATEGORY_LABELS[cat] ?? cat}</legend>
              {list.map((f) => (
                <label key={f.key} className="kp-custom-row">
                  <input type="checkbox" checked={selected.has(f.key)} onChange={() => toggle(f.key)} />
                  <span className="kp-custom-name">{f.name}</span>
                  <span className="kp-custom-price">{formatMoney(f.priceMonthly, pricing.currency)}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="kp-custom-total" aria-live="polite">
            {winner && result.discount > 0 && (
              <p className="kp-custom-save">{winner.name} bundle applied: you save {formatMoney(result.discount, pricing.currency)}</p>
            )}
            <p className="kp-price"><strong>{formatMoney(result.total, pricing.currency)}</strong><span>/month</span></p>
            <button type="button" className="kp-btn kp-btn--primary" disabled={selected.size === 0} onClick={go}>Start with this selection</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoSurprises() {
  return (
    <section className="kp-section kp-section--white" aria-labelledby="kp-nosurprise">
      <div className="kp-wrap kp-nosurprise">
        <div>
          <Eyebrow>No surprises</Eyebrow>
          <h2 id="kp-nosurprise" className="kp-h2">Try everything. Keep everything.</h2>
          <p className="kp-body">If you do not upgrade after your trial, nothing is deleted and you can always keep selling. Only extra records above the free limits pause.</p>
        </div>
        <ol className="kp-stages">
          {STAGES.map((s) => (
            <li key={s.title} className="kp-stage">
              <p className="kp-stage-when">{s.when}</p>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function QuoteCard({ t }: { t: Testimonial }) {
  const initials = t.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <figure className="kp-card kp-quote">
      <blockquote><p>&ldquo;{t.quote}&rdquo;</p></blockquote>
      <figcaption>
        {t.photo ? <img src={t.photo} alt="" width={40} height={40} loading="lazy" /> : <span className="kp-avatar" aria-hidden="true">{initials}</span>}
        <span><strong>{t.name}</strong><span>{t.business}, {t.city}</span></span>
      </figcaption>
    </figure>
  );
}

function Founding({ onStart }: { onStart: () => void }) {
  return (
    <div className="kp-founding kp-dark">
      {FOUNDING_PLACES_LEFT !== null && <span className="kp-badge">{FOUNDING_PLACES_LEFT} places left</span>}
      <p className="kp-founding-eyebrow">Founding customers</p>
      <h3>Be one of our first. Become our voice.</h3>
      <p className="kp-founding-text">Join as a founding customer in your industry and help shape what Kowope builds next. Your story could be the next one on this page.</p>
      <ul className="kp-founding-perks">
        {FOUNDING_PERKS.map((p) => <li key={p}><Check size={16} aria-hidden="true" />{p}</li>)}
      </ul>
      <button type="button" className="kp-btn kp-btn--primary kp-btn--lg kp-btn--block" onClick={onStart}>Become a founding customer</button>
    </div>
  );
}

function Words({ onStart }: { onStart: () => void }) {
  const [first, second] = TESTIMONIALS;
  const hasQuotes = TESTIMONIALS.length > 0;
  return (
    <section className="kp-section kp-section--page" aria-label={hasQuotes ? "In their words" : "Founding customers"}>
      <div className="kp-wrap">
        {hasQuotes && (
          <>
            <Eyebrow>In their words</Eyebrow>
            <h2 className="kp-h2">Owners already running on Kowope.</h2>
          </>
        )}
        <div className={hasQuotes ? "kp-grid3 kp-words" : "kp-founding-solo"}>
          {first && <QuoteCard t={first} />}
          <Founding onStart={onStart} />
          {second && <QuoteCard t={second} />}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const desktop = useMediaQuery("(min-width: 768px)");
  const refs = useRef<(HTMLDetailsElement | null)[]>([]);
  // Open list on web; accordion with the first item open on mobile.
  useEffect(() => {
    refs.current.forEach((d, i) => { if (d) d.open = desktop || i === 0; });
  }, [desktop]);
  return (
    <section id="faq" className="kp-section kp-section--white" aria-labelledby="kp-faq">
      <div className="kp-wrap kp-faq-wrap">
        <h2 id="kp-faq" className="kp-h2">Questions owners ask</h2>
        <div className="kp-faq">
          {FAQS.map((f, i) => (
            <details key={f.q} ref={(el) => { refs.current[i] = el; }} className="kp-q">
              <summary>
                <span>{f.q}</span>
                <ChevronDown size={20} aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function SignUp({ onStart }: { onStart: () => void }) {
  return (
    <section id="start" className="kp-section kp-section--white kp-start" aria-labelledby="kp-start">
      <div className="kp-wrap">
        <div className="kp-panel kp-dark">
          <h2 id="kp-start">Record your first sale today.</h2>
          <p className="kp-panel-sub">Free forever plan. 14-day Growth trial. No card needed.</p>
          <button type="button" className="kp-btn kp-btn--primary kp-btn--lg kp-panel-btn" onClick={onStart}>Start free</button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="kp-footer">
      <div className="kp-wrap kp-footer-in">
        <p>&copy; {new Date().getFullYear()} Kowope</p>
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}

function StickyBar({ onStart }: { onStart: () => void }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = document.getElementById("start");
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div className={`kp-bar${hidden ? " is-hidden" : ""}`}>
      <div>
        <p className="kp-bar-title">Start free today</p>
        <p className="kp-bar-sub">No card. Set up in 10 minutes.</p>
      </div>
      <button type="button" className="kp-btn kp-btn--primary" onClick={onStart}>Start free</button>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="kp">
      <Header onStart={goToStart} />
      <main>
        <Hero onStart={goToStart} />
        <Proof />
        <Why />
        <How />
        <Industries />
        <Pricing onStart={goToStart} />
        <NoSurprises />
        <Words onStart={goToStart} />
        <Faq />
        <SignUp onStart={goToStart} />
      </main>
      <Footer />
      <StickyBar onStart={goToStart} />
    </div>
  );
}
