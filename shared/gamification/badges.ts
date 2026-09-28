import type { GamificationSubjectType } from "@shared/schema";

export type BadgeDefinition = {
  key: string;
  subjectType: GamificationSubjectType;
  label: string;
  description: string;
  icon: string; // lucide-react icon name, resolved client-side
};

// Eligibility for each badge is evaluated server-side in GamificationRepository;
// this file is the shared copy/definition so client and server never disagree
// on what a badge is called or looks like.
export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  // Customer badges
  { key: "first_visit", subjectType: "customer", label: "First Visit", description: "Completed their first purchase", icon: "Sparkles" },
  { key: "regular_5", subjectType: "customer", label: "Regular", description: "5 completed visits", icon: "Repeat" },
  { key: "vip_20", subjectType: "customer", label: "VIP", description: "20 completed visits", icon: "Crown" },
  { key: "loyalty_streak_4", subjectType: "customer", label: "On a Roll", description: "Visited 4 weeks in a row", icon: "Flame" },

  // Staff badges
  { key: "first_sale", subjectType: "staff", label: "First Sale", description: "Closed their first sale", icon: "Sparkles" },
  { key: "sales_50", subjectType: "staff", label: "Closer", description: "50 completed sales", icon: "Award" },
  { key: "sales_200", subjectType: "staff", label: "Top Performer", description: "200 completed sales", icon: "Trophy" },
  { key: "on_time_streak_10", subjectType: "staff", label: "Punctual", description: "10 consecutive on-time shifts", icon: "Clock" },
  { key: "on_time_streak_30", subjectType: "staff", label: "Reliable", description: "30 consecutive on-time shifts", icon: "ShieldCheck" },

  // Owner / business badges
  { key: "first_month_revenue", subjectType: "owner", label: "Open For Business", description: "First month with recorded revenue", icon: "Sparkles" },
  { key: "revenue_streak_3", subjectType: "owner", label: "Momentum", description: "3 consecutive months of growing revenue", icon: "TrendingUp" },
  { key: "revenue_streak_6", subjectType: "owner", label: "Unstoppable", description: "6 consecutive months of growing revenue", icon: "Rocket" },
  { key: "customers_100", subjectType: "owner", label: "Growing Community", description: "100 customers served", icon: "Users" },
];

export function getBadgeDefinition(key: string): BadgeDefinition | undefined {
  return BADGE_DEFINITIONS.find(b => b.key === key);
}

export function badgesForSubject(subjectType: GamificationSubjectType): BadgeDefinition[] {
  return BADGE_DEFINITIONS.filter(b => b.subjectType === subjectType);
}

// Points awarded per event reason. Centralised here rather than scattered as
// magic numbers through repositories, since these are tuning knobs product
// will want to revisit.
export const POINTS_RULES = {
  customer_visit: 10,
  staff_sale: 5,
  staff_on_time_shift: 3,
} as const;
