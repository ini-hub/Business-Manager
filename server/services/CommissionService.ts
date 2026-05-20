export class CommissionSplitCalculator {
  private businessStaffShare: number;
  private storeStaffShare: number;
  private storeOverride: boolean;

  constructor(business: any, store: any) {
    this.businessStaffShare = business?.commissionSplitStaffShare ?? 20;
    this.storeStaffShare = store?.commissionSplitStaffShare ?? 20;
    this.storeOverride = store?.commissionSplitOverride ?? false;
  }

  public getStaffRate(item: any): number {
    if (item?.commissionSplitOverride) {
      return (item.commissionSplitStaffShare ?? 20) / 100;
    }
    if (this.storeOverride) {
      return this.storeStaffShare / 100;
    }
    return this.businessStaffShare / 100;
  }
}

export class CommissionService {
  /**
   * Calculates the commission share percentages for lead and assistant staff
   * based on the checkout commission split type ("equal" or "standard")
   */
  public calculateSplitShares(
    commissionSplit: string | null | undefined,
    staffCount: number
  ): { leadShare: number; asstShare: number } {
    let leadShare: number;
    let asstShare: number;

    if (commissionSplit === "equal") {
      leadShare = 1 / staffCount;
      asstShare = 1 / staffCount;
    } else {
      // Standard split:
      // 1 staff: 100% lead
      // 2 staff: 80% lead, 20% assistant
      // 3 staff: 60% lead, 20% assistant 1, 20% assistant 2
      leadShare = staffCount === 1 ? 1.0 : staffCount === 2 ? 0.8 : 0.6;
      asstShare = 0.2;
    }

    return { leadShare, asstShare };
  }

  /**
   * Distributes commission value for a service row to the lead and assistants
   */
  public distributeCommission(
    perServicePool: number,
    commissionSplit: string | null | undefined,
    assistantsCount: number
  ): { leadCommission: number; asstCommission: number } {
    const staffCount = 1 + assistantsCount;
    const { leadShare, asstShare } = this.calculateSplitShares(commissionSplit, staffCount);

    return {
      leadCommission: perServicePool * leadShare,
      asstCommission: perServicePool * asstShare,
    };
  }
}

export const commissionService = new CommissionService();
