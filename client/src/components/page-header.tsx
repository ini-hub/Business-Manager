import { Skeleton } from "@/components/ui/skeleton";
import { useLocation, Link } from "wouter";
import { ChevronRight, HelpCircle, Lightbulb, BookOpen, X, ChevronDown, CheckCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface GuideContent {
  title: string;
  badge: string;
  steps: string[];
  tips: string[];
}

const PAGE_GUIDES: Record<string, GuideContent> = {
  "/": {
    title: "Store Dashboard Overview",
    badge: "Analytics & Operations",
    steps: [
      "Track live business performance: Gross Revenue, Expenses, Active Transactions, and Net Profit.",
      "Check visual analytics charts to analyze hourly/daily sales patterns, top products, and peak busy hours.",
      "Leverage the Multi-Store Toggle in the header to view single-store statistics or consolidated all-store sheets."
    ],
    tips: [
      "Consolidated sheets aggregate P&L figures globally while maintaining parent organizational controls.",
      "Dashboard charts automatically refresh every 60 seconds to ensure you always have fresh data."
    ]
  },
  "/new-sale": {
    title: "Point of Sale (POS)",
    badge: "Sales & Cash Drawer Control",
    steps: [
      "Add catalog products or custom service packages to your active cart.",
      "Assign the handling Staff Member and a Customer (e.g. Walk-in) before checkout.",
      "Open Cash Drawer: If a drawer session isn't active, checkout will guide you to input your Opening Float and Notes.",
      "Add Discounts or toggle Customer Loyalty to redeem maximum eligible points (1 Point = ₦10 discount).",
      "Pick a payment method (Cash, Transfer, Card, Split, or Deposit) and tap Complete Sale."
    ],
    tips: [
      "For split payments, the sum of all payments must exactly equal the balance collected today.",
      "Manual discounts strictly require a valid reason and a manager override approval signature."
    ]
  },
  "/bookings": {
    title: "Appointments & Schedules",
    badge: "Calendar Calendar Management",
    steps: [
      "View live bookings color-coded by staff assignment under Day, Week, or Month formats.",
      "Click any empty time slot in the calendar grid to initialize a new booking request.",
      "Attach upfront Deposits to booking invoices to lock down scheduled time slots.",
      "Upon customer arrival, click 'Check-In' to automatically route their details and deposit directly to the POS."
    ],
    tips: [
      "Deposits captured in the booking modal dynamically deduct from the POS checkout total during final billing.",
      "You can filter the calendar view to only display specific staff members to manage their daily capacity."
    ]
  },
  "/inventory": {
    title: "Inventory & Stock Audits",
    badge: "Warehouse & Auditing Controls",
    steps: [
      "Create, edit, and search items, composite/bundled product packages, and services.",
      "Select the 'Audits' tab to perform physical reconciliations. Record counts and see real-time drift metrics.",
      "Choose predefined Drift Reasons (e.g. Theft, Damage, Data Entry) for shortage or surplus counts.",
      "Submit counts for approval; managers can tap 'Approve & Resolve Drifts' to atomically update stock values."
    ],
    tips: [
      "Resolving an audit drift automatically generates appropriate ledger adjustments for P&L tracking.",
      "Matrix variants (sizing, colors, versions) are managed inside the specific parent inventory details panel."
    ]
  },
  "/transactions": {
    title: "Transactions Ledger",
    badge: "Audits & Receipt Operations",
    steps: [
      "Audit every single POS checkout record with transparent color-coded status badges.",
      "Filter listings by date range, store branch, payment type, or specific customer IDs.",
      "Select any record to view its full transaction tree, reprint receipt sheets, or void sales."
    ],
    tips: [
      "Voiding a sale automatically restores components to inventory and completely reverses P&L revenue records.",
      "Only Managers and Owners have privileges to update payment states or void completed transactions."
    ]
  },
  "/payroll": {
    title: "Staff Payroll Management",
    badge: "Salaries & Commission Control",
    steps: [
      "Configure staff base salaries, pay frequency, and review their daily clock-in/out attendance cards.",
      "Create a new payroll run. The system automatically calculates earned commission during the timeframe.",
      "Apply custom deductions or bonuses manually to the slip before locking it in.",
      "Lock and approve the pay run to generate downloadable payslips for your employees."
    ],
    tips: [
      "Employees must clock in and out on the dedicated Staff Terminal to record attendance history.",
      "Staff commission percentages are calculated dynamically from lead and assistant split POS allocations."
    ]
  },
  "/profit-loss": {
    title: "Financial Statements & reports",
    badge: "P&L & Service Analysis",
    steps: [
      "Review the dynamic Income Statement to track sales revenues, cost of goods (COGS), and active operational expenses.",
      "Examine the Service Profitability metrics to identify which service lines yield the highest margins.",
      "Consolidate multiple branches globally to see unified business performance summaries."
    ],
    tips: [
      "Inventory variances (like approved stock shortages) are automatically categorized as operating expenses.",
      "Accounts Payable and direct expenditures are aggregated into the live Cash Flow statements automatically."
    ]
  },
  "/stock-transfers": {
    title: "Stock Transfers",
    badge: "Branch-to-Branch Logistics",
    steps: [
      "Initiate new transfers to move physical products from a source store to a destination branch.",
      "Mark as Shipped to transit goods; items enter a locked state safeguarding total inventory allocation figures.",
      "Upon physical verification at the receiving store, tap Fulfill to add the items into destination stock."
    ],
    tips: [
      "Stock in transit cannot be double-counted or sold at either store, securing internal logistics records.",
      "Auditing shipped products upon arrival protects branches against unaccounted damage or vendor loss."
    ]
  },
  "/purchase-orders": {
    title: "Purchase Orders (PO)",
    badge: "Vendor Sourcing & Restocking",
    steps: [
      "Map suppliers, record component pricing, and establish restocking frequencies.",
      "Draft and send Purchase Orders to vendors, moving statuses from Draft ➡️ Sent ➡️ Shipped.",
      "Verify incoming items; check in physical stock batches and auto-generate backorders for missing parts."
    ],
    tips: [
      "Entering batch expiration dates upon receiving goods triggers FIFO queue logic at the POS.",
      "Purchase Orders can be linked directly into accounts payable to monitor cost-outflow pipelines."
    ]
  },
  "/quotes": {
    title: "Quotes & Proforma Invoices",
    badge: "Invoicing Pipelines",
    steps: [
      "Generate formal Proforma Invoices or custom quotes with dynamic item selections.",
      "Export premium print-ready PDF copies to send to external or corporate clients.",
      "Upon deal closure, convert quotes into live POS checkout tickets with a single click."
    ],
    tips: [
      "Quotes do not count towards business revenue until converted to active, checked-out sales.",
      "Set expiration boundaries on quotes to automatically archive outdated price proposals."
    ]
  },
  "/settings-stores": {
    title: "Settings & Branch Admin",
    badge: "Configurations & Rules",
    steps: [
      "Manage branch details, operational business hours, localized store timezone, and custom receipt layouts.",
      "Configure dynamic tax rates (such as VAT or localized sales taxes) to toggle standard checkout percentages.",
      "Configure global parameters like custom system roles and granular user permission profiles."
    ],
    tips: [
      "Updating store currency automatically formats all product tags and POS dashboards for that store.",
      "Ensure localized tax structures are set as default to execute compliance calculations seamlessly."
    ]
  },
  "/customers": {
    title: "Customers Directory & Loyalty",
    badge: "CRM & Retentions",
    steps: [
      "Manage customer contact details, custom numbering, and view transaction history portfolios.",
      "Track customer loyalty balances and configure points ratios for targeted marketing campaigns.",
      "Filter listing sheets by outstanding debt status to recover arrears on pending credit invoices."
    ],
    tips: [
      "Loyalty points are automatically generated upon checkouts and can be redeemed for instant discount savings.",
      "Outstanding balances can be partially paid or completely cleared directly inside the customer details card."
    ]
  },
  "/staffs": {
    title: "Staff & Attendance roster",
    badge: "Employees & Operations",
    steps: [
      "Manage staff rosters, contact details, standard system roles, and commission percentages.",
      "Monitor daily clock-in/out attendance timestamps and review total hours worked.",
      "Provision secure PIN credentials for employees to lock down terminal checkout stations."
    ],
    tips: [
      "Staff attendance logs directly inform monthly payout commission sheets inside the payroll dashboard.",
      "Deactivating an employee immediately suspends their PIN access to terminal consoles."
    ]
  },
  "/expenses": {
    title: "Operating Expenses Ledger",
    badge: "Cost & Cash-flow Control",
    steps: [
      "Log direct cash outflows, branch utilities, employee bonuses, and supplier payments.",
      "Categorize expenses into operating classes (COGS, Rent, Utilities, Consumables) to build accurate P&Ls.",
      "Attach receipts or billing references to transactions for administrative audit tracking."
    ],
    tips: [
      "Expenses are automatically aggregated against sales revenue inside the profit & loss charts.",
      "Approved stock shortage audits are automatically logged as operations expenses for tax compliance."
    ]
  },
  "/credit-sales": {
    title: "Credit Sales Ledger",
    badge: "Arrears & Credit Control",
    steps: [
      "Monitor outstanding customer credit balances, payment terms, and expected due date boundaries.",
      "Send automated reminders via WhatsApp and SMS using templates in standard dialects.",
      "Record customer partial or full debt repayments directly to settle outstanding invoices.",
      "Review unified transaction timelines and repayment histories for specific directory accounts."
    ],
    tips: [
      "Outstanding balances can be partially repaid or settled in full with automated P&L adjustment tracking.",
      "Leverage the Credit Sales Reminder panel under Settings to configure automatic bilingual notification schedules."
    ]
  },
  "/staffs/performance": {
    title: "Staff Commissions & Performance",
    badge: "Analytics & Incentives",
    steps: [
      "Track total revenues, booked services, and sales counts generated per employee.",
      "Review lead and assistant splits for service payouts to calculate commission balances.",
      "Compare employee activity graphs to design incentive structures and capacity targets."
    ],
    tips: [
      "Commissions can be customized on a per-service level inside the main catalog.",
      "Performance curves help identify peak efficiency hours and optimize team scheduling."
    ]
  },
  "/reports/service-profitability": {
    title: "Service Profitability Analysis",
    badge: "Margins & Pricing",
    steps: [
      "Analyze margins across service packages relative to material consumables and staff costs.",
      "Track popularity metrics to see which services are booked most frequently by customers.",
      "Refine service pricing structures to optimize net profit returns per branch."
    ],
    tips: [
      "High-cost items can be bundled into composite inventory packages to automatically track their margins.",
      "Cross-referencing service popularity with labor cost highlights where you can streamline store operations."
    ]
  },
  "/settings/taxes": {
    title: "Taxes & Compliance Admin",
    badge: "Regulatory Settings",
    steps: [
      "Configure national VAT percentages or localized sales taxes for your store.",
      "Specify which tax rate is the store's default to auto-apply calculations to checkout carts.",
      "Verify tax computations comply with local business standards and transaction ledger outputs."
    ],
    tips: [
      "Taxes are calculated cleanly on the net subtotal after discounts and loyalty points have been deducted.",
      "Receipts dynamically display a line-by-line breakdown of tax components for absolute transparency."
    ]
  },
  "/settings/promotions": {
    title: "Promotions & BOGOF Campaigns",
    badge: "Marketing Campaigns",
    steps: [
      "Launch automated Buy-One-Get-One-Free (BOGOF) deals or spend-threshold discount triggers.",
      "Configure target date parameters to run seasonal holiday campaigns automatically.",
      "Toggle active statuses to dynamically enforce promotional cart logic at the checkout."
    ],
    tips: [
      "Spend-threshold promotions automatically reward free items or cart discounts in real-time.",
      "Keep target items stocked; checkout will warn cashiers if a reward item runs out of physical inventory."
    ]
  }
};

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  isLoading?: boolean;
}

export function PageHeader({ title, description, actions, isLoading = false }: PageHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
    );
  }

  const segments = location.split("/").filter(Boolean);

  // Map subroutes to main categories for guide selection
  let guidePath = location;
  if (location.startsWith("/transactions/")) guidePath = "/transactions";
  if (location.startsWith("/bookings/")) guidePath = "/bookings";
  if (location.startsWith("/inventory/")) guidePath = "/inventory";
  if (location.startsWith("/payroll/")) guidePath = "/payroll";
  if (location.startsWith("/sales/new")) guidePath = "/new-sale";
  if (location.startsWith("/settings/stores")) guidePath = "/settings-stores";
  if (location.startsWith("/customers/")) guidePath = "/customers";
  // /staffs/* is the admin roster+attendance area; /staffs/performance gets
  // its own, more specific guide below and must be checked after this one so
  // it wins. /staff/* (singular, personal attendance/performance) has no
  // dedicated guide — same as before this rename, when it fell outside the
  // "/staff/" prefix's own guide too.
  if (location === "/staffs" || location.startsWith("/staffs/")) guidePath = "/staffs";
  if (location.startsWith("/settings/taxes")) guidePath = "/settings/taxes";
  if (location.startsWith("/settings/promotions")) guidePath = "/settings/promotions";
  if (location.startsWith("/staffs/performance")) guidePath = "/staffs/performance";
  if (location.startsWith("/reports/service-profitability")) guidePath = "/reports/service-profitability";

  const guide = PAGE_GUIDES[guidePath];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          {segments.length > 0 && (
            <div className="flex items-center text-xs text-muted-foreground mb-2">
              <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
              {segments.map((seg, i) => {
                const url = "/" + segments.slice(0, i + 1).join("/");
                const label = seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");
                const isLast = i === segments.length - 1;
                return (
                  <div key={url} className="flex items-center">
                    <ChevronRight className="h-3 w-3 mx-1 opacity-50" />
                    {isLast ? (
                      <span className="font-medium text-foreground">{label}</span>
                    ) : (
                      <Link href={url} className="hover:text-foreground transition-colors">{label}</Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {guide && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-primary rounded-full"
                onClick={() => setIsOpen(!isOpen)}
                title="Page User Guide"
              >
                <HelpCircle className={`h-4 w-4 transition-transform duration-300 ${isOpen ? 'rotate-180 text-primary' : ''}`} />
              </Button>
            )}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">{actions}</div>}
      </div>

      {isOpen && guide && (
        <div className="border border-primary/20 bg-background/50 backdrop-blur-md rounded-xl p-5 shadow-xl glassmorphism animate-in slide-in-from-top-3 duration-300">
          <div className="flex items-center justify-between border-b pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-primary/10 rounded-lg text-primary">
                <BookOpen className="h-4.5 w-4.5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                  {guide.title}
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium tracking-wide uppercase">
                    {guide.badge}
                  </span>
                </h3>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md hover:bg-muted"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                Operational Workflow Steps
              </h4>
              <ul className="space-y-2.5">
                {guide.steps.map((step, idx) => (
                  <li key={idx} className="text-xs text-foreground/90 leading-relaxed flex items-start gap-2.5">
                    <span className="flex items-center justify-center h-4.5 w-4.5 rounded-full bg-primary/10 text-[10px] font-bold text-primary shrink-0 border border-primary/25">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3 md:border-l md:pl-6">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                Developer & Admin Pro-Tips
              </h4>
              <div className="space-y-2.5">
                {guide.tips.map((tip, idx) => (
                  <div key={idx} className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg text-xs leading-relaxed text-foreground/90">
                    {tip}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

