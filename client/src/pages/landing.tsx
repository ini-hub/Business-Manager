import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { Plan } from "@shared/schema";
import {
  Store,
  Users,
  Package,
  Coins,
  BarChart3,
  Shield,
  ShoppingCart,
  BookOpen,
  Wallet,
  CalendarDays,
  ArrowRight,
  CheckCircle2,
  TrendingUp,
  Zap,
  Globe,
  Star,
  ChevronDown,
  Receipt,
  Bell,
  CreditCard,
} from "lucide-react";

// ── Animated counter ───────────────────────────────────────────────────────
function useCounter(target: number, duration = 1800, started: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!started) return;
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration, started]);
  return count;
}

// ── Intersection observer ──────────────────────────────────────────────────
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

function StatCard({ value, suffix, label, started }: { value: number; suffix: string; label: string; started: boolean }) {
  const count = useCounter(value, 1800, started);
  return (
    <div className="text-center">
      <div className="text-4xl sm:text-5xl font-black text-white tabular-nums">
        {count.toLocaleString()}{suffix}
      </div>
      <div className="text-sm text-blue-300/70 mt-1 font-medium">{label}</div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc, color }: { icon: any; title: string; desc: string; color: string }) {
  return (
    <div className="group rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 hover:border-[#1169C7]/40 hover:bg-white/[0.07] transition-all duration-300 hover:-translate-y-0.5">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${color} mb-4`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <h3 className="font-bold text-white text-sm mb-2">{title}</h3>
      <p className="text-xs text-white/50 leading-relaxed">{desc}</p>
    </div>
  );
}

function FlowNode({ label, icon: Icon, pos, delay }: { label: string; icon: any; pos: string; delay: string }) {
  return (
    <div className={`absolute ${pos} flex flex-col items-center gap-1.5`} style={{ animationDelay: delay }}>
      <div className="h-10 w-10 rounded-full bg-[#0d1f3c] border border-[#1169C7]/40 flex items-center justify-center shadow-lg shadow-blue-900/40 animate-float">
        <Icon className="h-[18px] w-[18px] text-blue-400" />
      </div>
      <span className="text-[10px] font-semibold text-blue-400/60 whitespace-nowrap">{label}</span>
    </div>
  );
}

function Testimonial({ quote, name, role }: { quote: string; name: string; role: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 flex flex-col gap-4">
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map(i => <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />)}
      </div>
      <p className="text-sm text-white/65 leading-relaxed italic">"{quote}"</p>
      <div>
        <p className="text-sm font-bold text-white">{name}</p>
        <p className="text-xs text-blue-400">{role}</p>
      </div>
    </div>
  );
}

function PricingCard({ plan, highlighted }: { plan: Plan; highlighted?: boolean }) {
  const features = Array.isArray(plan.features) ? (plan.features as string[]) : [];
  return (
    <div
      className={`rounded-2xl border p-6 flex flex-col gap-5 ${
        highlighted
          ? "border-[#1169C7]/50 bg-[#1169C7]/[0.08]"
          : "border-white/[0.08] bg-white/[0.04]"
      }`}
    >
      <div>
        <h3 className="font-bold text-white">{plan.name}</h3>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-3xl font-black text-white">
            {plan.currency} {Number(plan.priceMonthly).toLocaleString()}
          </span>
          <span className="text-xs text-white/45">/mo</span>
        </div>
      </div>
      <ul className="space-y-2 flex-1">
        {features.map((feature, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-white/60">
            <CheckCircle2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
            {feature}
          </li>
        ))}
      </ul>
      <Link href="/auth/signup">
        <Button className="w-full bg-[#1169C7] hover:bg-[#1a7ae0] text-white font-bold border-0">
          Start free trial
        </Button>
      </Link>
    </div>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="flex gap-5 items-start">
      <div className="shrink-0 h-11 w-11 rounded-2xl bg-[#1169C7] flex items-center justify-center text-white font-black text-base shadow-lg shadow-blue-600/30">
        {n}
      </div>
      <div>
        <h4 className="font-bold text-white text-sm mb-1">{title}</h4>
        <p className="text-xs text-white/55 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const statsSection = useInView(0.3);
  const { data: plans = [] } = useQuery<Plan[]>({ queryKey: ["/api/billing/plans"] });

  return (
    // The outer background matches the app's dark mode hue (210°) so auth/app feel continuous
    <div className="min-h-screen bg-[hsl(214,22%,5%)] text-white overflow-x-hidden">

      {/* ── Subtle grid texture ─────────────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyNSkiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-100 z-0" />

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[hsl(214,22%,5%)]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[#1169C7] flex items-center justify-center shadow-md shadow-blue-600/40">
              <Coins className="h-4 w-4 text-white" />
            </div>
            <span className="text-xl font-black tracking-tight">
              Ko<span className="text-[#4d9fff]">wope</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm text-white/60">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
            <a href="#testimonials" className="hover:text-white transition-colors">Stories</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm" className="text-white/70 hover:text-white hover:bg-white/10">Sign in</Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="sm" className="bg-[#1169C7] hover:bg-[#1a7ae0] text-white font-bold shadow-md shadow-blue-700/40 border-0">
                Get started free
              </Button>
            </Link>
          </div>

          <button className="md:hidden text-white/60 hover:text-white p-1" onClick={() => setMenuOpen(v => !v)}>
            <div className="space-y-1.5">
              <div className={`h-0.5 w-5 bg-current transition-all ${menuOpen ? "rotate-45 translate-y-2" : ""}`} />
              <div className={`h-0.5 w-5 bg-current transition-all ${menuOpen ? "opacity-0" : ""}`} />
              <div className={`h-0.5 w-5 bg-current transition-all ${menuOpen ? "-rotate-45 -translate-y-2" : ""}`} />
            </div>
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-white/[0.06] bg-[hsl(214,22%,5%)] px-4 py-4 space-y-3">
            <a href="#features" className="block text-sm text-white/60 hover:text-white py-1" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#how-it-works" className="block text-sm text-white/60 hover:text-white py-1" onClick={() => setMenuOpen(false)}>How it works</a>
            <a href="#testimonials" className="block text-sm text-white/60 hover:text-white py-1" onClick={() => setMenuOpen(false)}>Stories</a>
            <div className="flex gap-3 pt-2 border-t border-white/[0.06]">
              <Link href="/auth/login" className="flex-1"><Button variant="outline" size="sm" className="w-full border-white/15 text-white hover:bg-white/10">Sign in</Button></Link>
              <Link href="/auth/signup" className="flex-1"><Button size="sm" className="w-full bg-[#1169C7] hover:bg-[#1a7ae0] text-white font-bold border-0">Get started</Button></Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[92vh] flex items-center overflow-hidden z-10">
        {/* Blue radial glows — matching app primary hue */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 h-[700px] w-[700px] rounded-full bg-[#1169C7]/10 blur-[130px]" />
          <div className="absolute top-1/4 right-1/4 h-[300px] w-[300px] rounded-full bg-amber-600/8 blur-[90px]" />
          <div className="absolute bottom-1/4 left-1/4 h-[200px] w-[200px] rounded-full bg-[#1169C7]/8 blur-[70px]" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-24 grid lg:grid-cols-2 gap-12 items-center">

          {/* Left — copy */}
          <div>
            {/* Name meaning badge — cultural flavor, not primary message */}
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/8 px-3.5 py-1.5 text-xs font-semibold text-amber-400/90 mb-6">
              <Coins className="h-3 w-3" />
              Kowope — Yoruba for "gather all the money completely"
            </div>

            {/* English-led headline for global clarity */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-[1.05] tracking-tight mb-5">
              One platform.{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4d9fff] via-[#1169C7] to-[#4d9fff]">
                Every naira.
              </span>
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4d9fff] to-white/80">
                Total control.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-white/55 leading-relaxed max-w-lg mb-8">
              Kowope brings every sale, every customer, every supplier, and every payment together — giving business owners complete visibility and control, anywhere in the world.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <Link href="/auth/signup">
                <Button size="lg" className="bg-[#1169C7] hover:bg-[#1a7ae0] text-white font-black text-sm px-7 py-5 rounded-xl shadow-xl shadow-blue-700/30 border-0 gap-2 group">
                  Start for free
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </Button>
              </Link>
              <Link href="/auth/login">
                <Button size="lg" variant="outline" className="border-white/15 text-white/80 hover:bg-white/8 hover:text-white text-sm px-7 py-5 rounded-xl">
                  Sign in to your account
                </Button>
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/40">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#4d9fff]" />No credit card</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#4d9fff]" />Works offline</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#4d9fff]" />Multi-currency</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#4d9fff]" />Any device</span>
            </div>
          </div>

          {/* Right — gathering diagram */}
          <div className="relative hidden lg:flex items-center justify-center h-[440px]">

            {/* SVG connecting lines */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 440 440" fill="none">
              <defs>
                <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1169C7" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#1169C7" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              {[
                [72,72, 195,200],
                [368,72, 245,200],
                [40,220, 185,220],
                [400,220, 255,220],
                [72,368, 195,240],
                [368,368, 245,240],
              ].map(([x1,y1,x2,y2],i) => (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="url(#lg1)" strokeWidth="1.5" strokeDasharray="5 4" />
              ))}
            </svg>

            {/* Central orb */}
            <div className="relative z-10 h-28 w-28 rounded-full bg-gradient-to-br from-[#1169C7] to-[#0a4a9e] flex items-center justify-center shadow-2xl shadow-blue-700/50">
              <div className="h-24 w-24 rounded-full bg-gradient-to-br from-[#1a7ae0] to-[#1169C7] flex flex-col items-center justify-center gap-0.5">
                <Coins className="h-7 w-7 text-white" />
                <span className="text-[9px] font-black text-white/80 tracking-[0.15em] uppercase">Kowope</span>
              </div>
              <div className="absolute inset-0 rounded-full border-2 border-[#1169C7]/50 animate-ping" style={{ animationDuration: "3s" }} />
              <div className="absolute -inset-4 rounded-full border border-[#1169C7]/15 animate-ping" style={{ animationDuration: "3s", animationDelay: "0.8s" }} />
            </div>

            {/* Satellite nodes */}
            <FlowNode label="Sales" icon={ShoppingCart} pos="top-8 left-8" delay="0s" />
            <FlowNode label="Customers" icon={Users} pos="top-8 right-8" delay="0.4s" />
            <FlowNode label="Inventory" icon={Package} pos="top-1/2 -translate-y-1/2 left-0" delay="0.8s" />
            <FlowNode label="Analytics" icon={BarChart3} pos="top-1/2 -translate-y-1/2 right-0" delay="1.2s" />
            <FlowNode label="Bookings" icon={CalendarDays} pos="bottom-8 left-8" delay="1.6s" />
            <FlowNode label="Payroll" icon={Wallet} pos="bottom-8 right-8" delay="2s" />
          </div>
        </div>

        <a href="#features" className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-white/25 hover:text-white/50 transition-colors">
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </a>
      </section>

      {/* ── Stats ───────────────────────────────────────────────────────── */}
      <section ref={statsSection.ref} className="py-14 border-y border-white/[0.06] bg-[hsl(214,22%,6%)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          <StatCard value={12000} suffix="+" label="Transactions processed" started={statsSection.inView} />
          <StatCard value={350} suffix="+" label="Businesses worldwide" started={statsSection.inView} />
          <StatCard value={99} suffix="%" label="Uptime reliability" started={statsSection.inView} />
          <StatCard value={4} suffix="s" label="Average checkout time" started={statsSection.inView} />
        </div>
      </section>

      {/* ── The concept section ─────────────────────────────────────────── */}
      <section className="py-20 relative z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1169C7]/30 bg-[#1169C7]/10 px-3 py-1 text-xs font-semibold text-blue-400 mb-5">
              <Globe className="h-3 w-3" />
              Built for business everywhere
            </div>
            <h2 className="text-4xl sm:text-5xl font-black leading-tight mb-5">
              Scattered data costs you{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4d9fff] to-[#1169C7]">
                real money.
              </span>
            </h2>
            <p className="text-white/55 leading-relaxed mb-6 text-sm sm:text-base">
              Missing receipts, untracked credit, manual payroll calculations, and offline sales that never got recorded — every gap is money that doesn't come back. Kowope closes every gap automatically.
            </p>
            <ul className="space-y-3">
              {[
                "Every sale captured — online and offline",
                "Every customer debt tracked and reminded automatically",
                "Every staff member paid accurately, every payroll period",
                "Every report ready the moment you need it",
              ].map(item => (
                <li key={item} className="flex items-start gap-3 text-sm text-white/65">
                  <CheckCircle2 className="h-4 w-4 text-[#4d9fff] mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Live dashboard preview card */}
          <div className="relative">
            {/* Stack effect */}
            <div className="absolute top-3 left-3 right-0 bottom-0 rounded-2xl border border-white/[0.06] bg-white/[0.02] rotate-2" />
            <div className="absolute top-1.5 left-1.5 right-1.5 bottom-1.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] -rotate-0.5" />

            {/* Main card — uses app's card bg to bridge visually */}
            <div className="relative rounded-2xl border border-[#1169C7]/25 bg-[hsl(214,22%,8%)] p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-[#1169C7]/20 border border-[#1169C7]/30 flex items-center justify-center">
                    <BarChart3 className="h-4 w-4 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Today's Summary</p>
                    <p className="text-[10px] text-white/40">All stores combined</p>
                  </div>
                </div>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 flex items-center gap-1">
                  <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />Live
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: "Revenue", value: "₦284,500", trend: "+12%", up: true },
                  { label: "Transactions", value: "47 sales", trend: "+8%", up: true },
                  { label: "New customers", value: "12 today", trend: "+3", up: true },
                  { label: "Outstanding", value: "₦18,000", trend: "2 overdue", up: false },
                ].map(s => (
                  <div key={s.label} className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-3">
                    <p className="text-[9px] text-white/40 mb-1 uppercase tracking-wide">{s.label}</p>
                    <p className="text-sm font-black text-white">{s.value}</p>
                    <p className={`text-[9px] font-semibold mt-0.5 flex items-center gap-0.5 ${s.up ? "text-emerald-400" : "text-amber-400"}`}>
                      <TrendingUp className="h-2.5 w-2.5" />{s.trend}
                    </p>
                  </div>
                ))}
              </div>

              {/* Revenue bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[9px] text-white/35">
                  <span>Daily target</span>
                  <span>71% reached</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/[0.06]">
                  <div className="h-full w-[71%] rounded-full bg-gradient-to-r from-[#1169C7] to-[#4d9fff]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section id="features" className="py-20 bg-[hsl(214,22%,6%)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1169C7]/30 bg-[#1169C7]/10 px-3 py-1 text-xs font-semibold text-blue-400 mb-4">
              Everything in one place
            </div>
            <h2 className="text-4xl sm:text-5xl font-black mb-3">
              Every tool your{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4d9fff] to-[#1169C7]">
                business needs.
              </span>
            </h2>
            <p className="text-white/45 max-w-lg mx-auto text-sm">
              No patchwork of apps. No manual spreadsheets. One platform that covers your entire operation.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: ShoppingCart, title: "Point of Sale", desc: "Fast checkout with offline mode, split payments, custom discounts, and instant receipt generation.", color: "bg-[#1169C7]" },
              { icon: Users, title: "Customer Management", desc: "Loyalty points, store credit, credit tracking, cross-branch history, and automated WhatsApp reminders.", color: "bg-[#0d5fa8]" },
              { icon: Package, title: "Inventory Control", desc: "Real-time stock tracking, low-stock alerts, variants, bundles, batches, and restock management.", color: "bg-[#0e4f8a]" },
              { icon: Wallet, title: "Payroll & Attendance", desc: "Commission splits, attendance tracking, auto-calculated payroll, and one-click approval.", color: "bg-[#7c3aed]" },
              { icon: CalendarDays, title: "Bookings & Appointments", desc: "4-step booking wizard with deposits, automated reminders, and direct conversion to a POS sale.", color: "bg-[#0369a1]" },
              { icon: BarChart3, title: "Real-Time Analytics", desc: "P&L, revenue trends, staff performance, cash flow — updated instantly as every sale closes.", color: "bg-[#0f766e]" },
              { icon: BookOpen, title: "Credit Book", desc: "Track every 'buy now pay later' transaction with configurable automated reminders before and after due dates.", color: "bg-[#b45309]" },
              { icon: Store, title: "Multi-Store & Multi-Currency", desc: "Manage every branch from one account. Isolated data per store, any currency, any timezone.", color: "bg-[#6d28d9]" },
              { icon: Shield, title: "Role-Based Access", desc: "Owner, manager, and staff roles with custom permissions. Full audit trail on every action.", color: "bg-[#374151]" },
            ].map(f => <FeatureCard key={f.title} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 relative z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-14 items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1169C7]/30 bg-[#1169C7]/10 px-3 py-1 text-xs font-semibold text-blue-400 mb-5">
              Up and running in minutes
            </div>
            <h2 className="text-4xl font-black mb-10">
              Three steps to{" "}
              <span className="text-[#4d9fff]">gather everything.</span>
            </h2>
            <div className="space-y-8">
              <Step n="1" title="Create your business" desc="Sign up, name your business, and add your first store. Under 90 seconds, no card needed." />
              <Step n="2" title="Load inventory & team" desc="Add products, services, and staff. Import in bulk or one by one — your call." />
              <Step n="3" title="Start selling" desc="Open the register, select items, collect payment, send receipt. It's that fast." />
            </div>
          </div>

          <div className="space-y-3 lg:pt-20">
            {[
              { icon: Zap, title: "Instant to learn", desc: "Staff can master the POS in under 5 minutes. No manuals, no training sessions." },
              { icon: Globe, title: "Works without internet", desc: "Offline mode captures every sale. Auto-syncs the moment you reconnect." },
              { icon: Bell, title: "Automated everywhere", desc: "Credit reminders, booking alerts, low-stock warnings — all run without you." },
              { icon: Receipt, title: "Receipts on WhatsApp", desc: "One tap sends a professional receipt directly to your customer's phone." },
              { icon: CreditCard, title: "Multiple payment methods", desc: "Cash, card, bank transfer, split payments, store credit — all in one checkout." },
            ].map(item => (
              <div key={item.title} className="flex gap-4 items-start rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 hover:border-[#1169C7]/30 transition-colors">
                <div className="h-9 w-9 rounded-lg bg-[#1169C7]/20 border border-[#1169C7]/25 flex items-center justify-center shrink-0">
                  <item.icon className="h-4 w-4 text-blue-400" />
                </div>
                <div>
                  <p className="font-bold text-sm text-white mb-0.5">{item.title}</p>
                  <p className="text-xs text-white/50 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ────────────────────────────────────────────────── */}
      <section id="testimonials" className="py-20 bg-[hsl(214,22%,6%)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1169C7]/30 bg-[#1169C7]/10 px-3 py-1 text-xs font-semibold text-blue-400 mb-4">
              From our users
            </div>
            <h2 className="text-4xl font-black">
              Real businesses.{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4d9fff] to-[#1169C7]">
                Real results.
              </span>
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Testimonial
              quote="Before Kowope I was writing everything in a notebook. Now I close my day in 2 minutes and know exactly what I made. It completely changed how I run my salon."
              name="Adunola Bakare"
              role="Beauty Salon Owner · Lagos, Nigeria"
            />
            <Testimonial
              quote="The credit tracking feature alone doubled my collections. Customers get automatic reminders and I don't have to chase anyone anymore. Absolutely worth it."
              name="Chukwuemeka Obi"
              role="Electronics Store · Abuja, Nigeria"
            />
            <Testimonial
              quote="I manage 3 branches from my phone. The multi-store dashboard shows me everything happening in real time. I don't need to be on-ground at every location."
              name="Fatima Al-Hassan"
              role="Fashion & Accessories · Kano, Nigeria"
            />
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#1169C7]/30 bg-[#1169C7]/10 px-3 py-1 text-xs font-semibold text-blue-400 mb-4">
              Simple pricing
            </div>
            <h2 className="text-4xl sm:text-5xl font-black mb-3">
              Start free.{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4d9fff] to-[#1169C7]">
                Upgrade when ready.
              </span>
            </h2>
            <p className="text-white/45 max-w-lg mx-auto text-sm">
              Every plan starts with a 14-day free trial — full access, no card required.
            </p>
          </div>

          {plans.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 max-w-2xl mx-auto">
              {plans.map((plan, i) => (
                <PricingCard key={plan.id} plan={plan} highlighted={i === plans.length - 1} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="py-24 relative z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="relative rounded-3xl border border-[#1169C7]/25 bg-[hsl(214,22%,8%)] p-12 sm:p-16 overflow-hidden">
            {/* Blue glow */}
            <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 rounded-full bg-[#1169C7]/15 blur-[80px]" />

            <div className="relative">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1169C7] mb-6 shadow-xl shadow-blue-700/40 mx-auto">
                <Coins className="h-7 w-7 text-white" />
              </div>

              <h2 className="text-4xl sm:text-5xl font-black mb-3">
                Gather every naira.
              </h2>
              {/* Yoruba used as flavor in the CTA — cultural depth, not primary message */}
              <p className="text-sm text-amber-400/80 font-semibold mb-4 tracking-wide">
                Ko gbogbo owo — starting today.
              </p>
              <p className="text-white/50 max-w-md mx-auto mb-10 text-sm leading-relaxed">
                Join businesses worldwide using Kowope to close every gap, track every naira, and grow with total confidence.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/auth/signup">
                  <Button size="lg" className="bg-[#1169C7] hover:bg-[#1a7ae0] text-white font-black text-sm px-10 py-5 rounded-xl shadow-xl shadow-blue-700/30 border-0 gap-2 group">
                    Get started — it's free
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                  </Button>
                </Link>
                <Link href="/auth/login">
                  <Button size="lg" variant="outline" className="border-white/15 text-white/75 hover:bg-white/8 hover:text-white text-sm px-10 py-5 rounded-xl">
                    I have an account
                  </Button>
                </Link>
              </div>
              <p className="text-[11px] text-white/25 mt-6">Free to start · No credit card · Cancel anytime</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-[#1169C7] flex items-center justify-center">
              <Coins className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-black text-sm">Ko<span className="text-[#4d9fff]">wope</span></span>
          </div>
          <p className="text-[11px] text-white/25 text-center">
            Ko gbogbo owo — Gather all the money completely. Built for businesses worldwide.
          </p>
          <div className="flex gap-4 text-xs text-white/35">
            <Link href="/auth/login" className="hover:text-white/60 transition-colors">Sign In</Link>
            <Link href="/auth/signup" className="hover:text-white/60 transition-colors">Sign Up</Link>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
        }
        .animate-float { animation: float 4s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
