import { AccountingRepository } from "../repositories/AccountingRepository";
import { AnalyticsService } from "./AnalyticsService";

const accountingRepository = new AccountingRepository();
const analyticsService = new AnalyticsService();

export interface BalanceSheet {
  totalAssets: number;
  totalLiabilities: number;
  totalCapitalInvested: number;
  totalWithdrawals: number;
  cumulativeNetProfit: number;
  retainedEarnings: number;
  totalEquity: number;
  netWorth: number;
  roi: number | null;
  assetsByCategory: { category: string; total: number }[];
}

export class AccountingService {
  /**
   * Retained earnings and ROI here are a management-oriented view, not
   * double-entry bookkeeping: assets/liabilities are manually tracked entries
   * rather than postings that a sale automatically updates. Retained earnings
   * is derived (never stored) as all-time net profit minus withdrawals, so it
   * carries forward continuously with no period-close step.
   */
  public async getBalanceSheet(storeId: string): Promise<BalanceSheet> {
    const [assetRows, liabilityRows, contributionRows, profitLossSummary] = await Promise.all([
      accountingRepository.listAssets(storeId),
      accountingRepository.listLiabilities(storeId),
      accountingRepository.listCapitalContributions(storeId),
      analyticsService.getProfitLossSummary(storeId),
    ]);

    const totalAssets = assetRows.reduce((sum, a) => sum + Number(a.value), 0);
    const totalLiabilities = liabilityRows.reduce((sum, l) => sum + Number(l.amount), 0);

    const totalCapitalInvested = contributionRows
      .filter((c) => c.type === "capital_injection")
      .reduce((sum, c) => sum + Number(c.amount), 0);
    const totalWithdrawals = contributionRows
      .filter((c) => c.type === "withdrawal")
      .reduce((sum, c) => sum + Number(c.amount), 0);

    const cumulativeNetProfit = Number(profitLossSummary.operatingProfit ?? 0);
    const retainedEarnings = cumulativeNetProfit - totalWithdrawals;
    const netCapital = totalCapitalInvested - totalWithdrawals;
    const totalEquity = netCapital + retainedEarnings;

    const assetsByCategory = Object.entries(
      assetRows.reduce<Record<string, number>>((acc, a) => {
        acc[a.category] = (acc[a.category] || 0) + Number(a.value);
        return acc;
      }, {})
    ).map(([category, total]) => ({ category, total }));

    return {
      totalAssets,
      totalLiabilities,
      totalCapitalInvested,
      totalWithdrawals,
      cumulativeNetProfit,
      retainedEarnings,
      totalEquity,
      netWorth: totalAssets - totalLiabilities,
      roi: totalCapitalInvested > 0 ? retainedEarnings / totalCapitalInvested : null,
      assetsByCategory,
    };
  }
}
