import { BaseApiService } from "./BaseApiService";

export class AnalyticsApiService extends BaseApiService {
  public async getProfitLossSummary(storeId: string, startDate?: string, endDate?: string): Promise<any> {
    const params = new URLSearchParams();
    params.append("storeId", storeId);
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    return this.get<any>(`/api/profit-loss/summary?${params.toString()}`);
  }

  public async getServiceProfitability(storeId: string, startDate?: string, endDate?: string): Promise<any> {
    const params = new URLSearchParams();
    params.append("storeId", storeId);
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    return this.get<any>(`/api/reports/service-profitability?${params.toString()}`);
  }

  public async getDashboardStats(storeId: string, queryString?: string): Promise<any> {
    const q = queryString ? (queryString.startsWith("&") ? queryString : `&${queryString}`) : "";
    return this.get<any>(`/api/dashboard/stats?storeId=${storeId}${q}`);
  }

  public async getTopCustomers(storeId: string): Promise<any[]> {
    return this.get<any[]>(`/api/reports/top-customers?storeId=${storeId}`);
  }
}

export const analyticsApi = new AnalyticsApiService();
