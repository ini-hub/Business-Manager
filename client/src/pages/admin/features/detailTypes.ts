/** Mirrors the visibility report returned by GET /api/admin/feature-catalog/:key. */
export interface VisibilityCheck {
  id: "active" | "flag" | "parent" | "dependencies";
  label: string;
  detail: string;
  result: "pass" | "blocks" | "note";
}
export interface VisibilityReport {
  status: "visible" | "scoped" | "hidden";
  checks: VisibilityCheck[];
}

export interface FeatureDetailData {
  feature: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    tierType: string;
    priceMonthly: number | null;
    priceAnnual: number | null;
    currency: string;
    freeLimit: number | null;
    tierCapacity: number | null;
    limitType: string | null;
    section: string | null;
    permissionModule: string | null;
    isActive: boolean;
    reviewStatus: string;
  };
  flag: { id: string; name: string; status: string } | null;
  scopedOrgs: { id: string; name: string }[];
  visibility: VisibilityReport;
  registry: { inRegistry: boolean; parentKey: string | null; dependsOn: string[]; gatePending: boolean };
}
