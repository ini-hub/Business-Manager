// Copy and sample data for the landing page. Anything that has no real value
// yet (proof figures, permissioned quotes, founding places) is left empty or
// null and the page hides that element instead of showing placeholder text.

export type Tone = "accent" | "success" | "warning" | "danger" | "neutral";

export const SIGNUP_PATH = "/auth/signup";
export const LOGIN_PATH = "/auth/login";
export const ROTATE_MS = 4000;

export const NAV_LINKS = [
  { id: "how", label: "How it works" },
  { id: "industries", label: "Industries" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
] as const;

export interface Scene {
  key: string;
  status: string;
  tone: Tone;
  announcement: string;
  shop: string;
  owner: string;
  hero: { label: string; value: string; sub: string };
  tiles: [{ label: string; value: string }, { label: string; value: string }];
  rows: { name: string; amount?: string; badge?: { text: string; tone: Tone } }[];
  cardA: { title: string; sub: string };
  cardB: { title: string; sub: string };
}

// Figures here illustrate the product screen; they are not customer claims.
export const SCENES: Scene[] = [
  {
    key: "salon",
    status: "New",
    tone: "accent",
    announcement: "Booking and commission for salons",
    shop: "Lekki salon",
    owner: "Adaeze",
    hero: { label: "Today's sales", value: "₦86,500", sub: "14 sales · 11 customers" },
    tiles: [
      { label: "Bookings", value: "9 today" },
      { label: "Commission due", value: "₦18,400" },
    ],
    rows: [
      { name: "Box braids · Tobi", amount: "₦25,000" },
      { name: "Gel nails · Amaka", amount: "₦8,000" },
      { name: "Hair cream x2", badge: { text: "Low", tone: "warning" } },
    ],
    cardA: { title: "Booking confirmed", sub: "Kemi · Saturday 10:00" },
    cardB: { title: "Reminder sent", sub: "Booking at 4:30 pm" },
  },
  {
    key: "shop",
    status: "Live",
    tone: "success",
    announcement: "Credit sales and reminders for shops",
    shop: "Bodija shop",
    owner: "Funke",
    hero: { label: "Today's sales", value: "₦142,300", sub: "31 sales · 24 customers" },
    tiles: [
      { label: "Credit owed", value: "₦245,000" },
      { label: "Low stock", value: "7 items" },
    ],
    rows: [
      { name: "Rice 50kg · on credit", amount: "₦78,000" },
      { name: "Peak milk x6", amount: "₦14,400" },
      { name: "Indomie carton", badge: { text: "Low", tone: "warning" } },
    ],
    cardA: { title: "Credit repaid", sub: "Mrs Bello · ₦12,000" },
    cardB: { title: "Reminder sent", sub: "6 credit customers" },
  },
  {
    key: "pharmacy",
    status: "Live",
    tone: "success",
    announcement: "Stock audit and purchase orders for pharmacies",
    shop: "Wuse pharmacy",
    owner: "Ngozi",
    hero: { label: "Today's sales", value: "₦97,800", sub: "22 sales · 19 customers" },
    tiles: [
      { label: "Stock audit", value: "72% done" },
      { label: "Orders pending", value: "3 POs" },
    ],
    rows: [
      { name: "Paracetamol 500mg", amount: "₦1,200" },
      { name: "Amoxicillin caps", amount: "₦3,500" },
      { name: "Vitamin C syrup", badge: { text: "Expiring", tone: "danger" } },
    ],
    cardA: { title: "Order received", sub: "Supplier order · 12 items" },
    cardB: { title: "Audit complete", sub: "Variance ₦0" },
  },
  {
    key: "restaurant",
    status: "Beta",
    tone: "warning",
    announcement: "Attendance and payroll for restaurants",
    shop: "Garki kitchen",
    owner: "Tolu",
    hero: { label: "Today's sales", value: "₦213,400", sub: "48 orders · 6 tables open" },
    tiles: [
      { label: "Staff in", value: "6 of 8" },
      { label: "Shift cash", value: "₦124,500" },
    ],
    rows: [
      { name: "Jollof rice x3", amount: "₦9,000" },
      { name: "Small chops tray", amount: "₦12,000" },
      { name: "Tobi · clocked in 8:02", badge: { text: "On shift", tone: "success" } },
    ],
    cardA: { title: "Shift closed", sub: "Variance ₦0" },
    cardB: { title: "Payroll ready", sub: "8 staff this month" },
  },
  {
    key: "wholesale",
    status: "Coming soon",
    tone: "neutral",
    announcement: "Quotes and stock transfer for wholesalers",
    shop: "Kano depot",
    owner: "Ibrahim",
    hero: { label: "Today's sales", value: "₦1,860,000", sub: "9 orders · 7 retailers" },
    tiles: [
      { label: "Open quotes", value: "12" },
      { label: "Credit limit used", value: "64%" },
    ],
    rows: [
      { name: "Quote · Uche Stores", amount: "₦412,000" },
      { name: "Sugar 50kg x20", amount: "₦1,560,000" },
      { name: "Transfer to Sabon Gari", badge: { text: "In transit", tone: "accent" } },
    ],
    cardA: { title: "Quote accepted", sub: "Uche Stores · ₦412,000" },
    cardB: { title: "Transfer received", sub: "Sabon Gari outlet" },
  },
];

export const REASSURANCES = ["Works offline", "Set up in 10 minutes", "Your data is never deleted"];

// Fill with real figures to show the proof strip, e.g. { value: "1,200+", label: "businesses" }.
export const PROOF: { value: string; label: string }[] = [];

export const SWITCH_CARDS = [
  {
    title: "Remember who owes you",
    text: "Every credit sale, balance and due date in one list, with polite WhatsApp reminders sent for you.",
    snippet: [
      { name: "Mrs Bello", badge: "₦12,000 due", tone: "danger" as Tone },
      { name: "Uche Stores", badge: "Paid", tone: "success" as Tone },
    ],
  },
  {
    title: "Know what is on every shelf",
    text: "Stock updates with every sale. Low-stock alerts, audits in minutes, and transfers between stores.",
    snippet: [
      { name: "Peak milk 400g", badge: "Out of stock", tone: "danger" as Tone },
      { name: "Indomie carton", badge: "Low", tone: "warning" as Tone },
    ],
  },
  {
    title: "See the shop when you are away",
    text: "Sales, staff attendance and the till, live on your phone from anywhere you are.",
    snippet: [
      { name: "Tobi · clocked in 8:02", badge: "On shift", tone: "success" as Tone },
      { name: "Shift close variance", badge: "₦0", tone: "neutral" as Tone },
    ],
  },
];

export const STEPS = [
  { title: "Sign up with your phone", text: "Your number and an SMS code. No email, no card." },
  { title: "Pick your kind of business", text: "Salon, shop, restaurant, pharmacy or wholesale. Kowope sets itself up to match." },
  { title: "Record a sale", text: "Add items, take payment, send the receipt. Online or offline." },
];

export const INDUSTRIES = [
  { title: "Salons, barbers and spas", text: "Bookings without double-booking, fair stylist commission, clients who come back.", modules: "Booking · Commission · Loyalty" },
  { title: "Shops and provisions", text: "Credit customers tracked, stock you can trust, a till that balances.", modules: "Credit sales · Inventory · Register shifts" },
  { title: "Fashion and boutiques", text: "Every size and colour as its own stock line, with promotions that move slow items.", modules: "Variants · Promotions · Broadcast" },
  { title: "Restaurants and bakeries", text: "Balanced shifts, staff attendance and lateness, payroll at month end.", modules: "Attendance · Shifts · Payroll" },
  { title: "Pharmacies", text: "Audit-ready stock, supplier purchase orders and vendor bills in one place.", modules: "Stock audit · Purchase orders · Taxes" },
  { title: "Wholesale and distribution", text: "Fast quotes, credit limits per retailer, stock moved between outlets.", modules: "Quotes · Credit limits · Stock transfer" },
];

// The Free card is fixed copy. Paid cards are NOT here: they are the admin-managed
// bundles (Super Admin > Bundles), priced from the live catalog via
// GET /api/billing/pricing, so they can't drift from billing.
export const FREE_PLAN = {
  key: "free", name: "Free", tagline: "For getting off the notebook",
  features: ["1 store, 2 staff", "30 customers, 50 items", "Unlimited sales and receipts"], cta: "Start free",
};

export const STAGES = [
  { when: "Day 1 to 14", title: "Free trial", text: "All Growth tools on." },
  { when: "Day 15 to 21", title: "Grace week", text: "Full access while you decide." },
  { when: "After", title: "Free plan", text: "Extras read-only, sales open, exports always." },
];

// Only real, permissioned quotes. Shape: { quote, name, business, city, photo? }.
export interface Testimonial { quote: string; name: string; business: string; city: string; photo?: string }
export const TESTIMONIALS: Testimonial[] = [];

// Set to a number to show the "N places left" badge on the founding card.
export const FOUNDING_PLACES_LEFT: number | null = null;

export const FOUNDING_PERKS = [
  "Founding price locked in",
  "Early access to new modules before release",
  "Your business featured on Kowope, with your permission",
];

export const FAQS = [
  { q: "Does it work without internet?", a: "Yes. If you lose connection, you can keep recording sales. They are saved on your device and sent automatically once you are back online. Prices and stock show what was last loaded, so open the app online first." },
  { q: "Do I need anyone to set it up for me?", a: "No. A short setup walks you through your store details, your first staff member and your first item, and you can skip any step and come back later. A checklist on your dashboard shows what is left, and help is available in the app by chat or email." },
  { q: "What happens when my trial ends?", a: "You get 7 extra days. After that, records above the free limits become read-only, not deleted, and you can keep selling." },
  { q: "How do I pay?", a: "Card, bank transfer or USSD, monthly or yearly." },
];
