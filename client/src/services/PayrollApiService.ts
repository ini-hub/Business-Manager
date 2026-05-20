import { BaseApiService } from "./BaseApiService";
import type { PayrollPeriod, PayrollEntryWithStaff } from "@shared/schema";

export class PayrollApiService extends BaseApiService {
  public async getPayrollPeriods(storeId: string): Promise<PayrollPeriod[]> {
    return this.get<PayrollPeriod[]>(`/api/payroll/periods?storeId=${storeId}`);
  }

  public async getPayrollPeriod(id: string): Promise<PayrollPeriod> {
    return this.get<PayrollPeriod>(`/api/payroll/periods/${id}`);
  }

  public async calculatePayroll(periodId: string): Promise<PayrollEntryWithStaff[]> {
    return this.post<PayrollEntryWithStaff[]>(`/api/payroll/periods/${periodId}/calculate`);
  }

  public async approvePayroll(periodId: string): Promise<PayrollPeriod> {
    return this.post<PayrollPeriod>(`/api/payroll/periods/${periodId}/approve`);
  }

  public async getPayrollDrilldown(periodId: string, staffId: string): Promise<any> {
    return this.get<any>(`/api/payroll/periods/${periodId}/drilldown/${staffId}`);
  }
}

export const payrollApi = new PayrollApiService();
