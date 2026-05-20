import { BaseApiService } from "./BaseApiService";

export class BulkUploadApiService extends BaseApiService {
  public async uploadStaff(data: any[], storeId: string): Promise<any> {
    return this.post<any>("/api/staff/bulk", { data, storeId });
  }

  public async uploadExpenses(expenses: any[], storeId: string): Promise<any> {
    return this.post<any>("/api/expenses/bulk", { expenses, storeId });
  }
}

export const bulkUploadApi = new BulkUploadApiService();
