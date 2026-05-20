import { BaseApiService } from "./BaseApiService";
import type { Inventory, InsertInventory } from "@shared/schema";

export class InventoryApiService extends BaseApiService {
  public async getInventory(storeId: string): Promise<Inventory[]> {
    return this.get<Inventory[]>(`/api/inventory?storeId=${storeId}`);
  }

  public async getInventoryItem(id: string): Promise<Inventory> {
    return this.get<Inventory>(`/api/inventory/${id}`);
  }

  public async getRestockHistory(id: string): Promise<any[]> {
    return this.get<any[]>(`/api/inventory/${id}/restock-history`);
  }

  public async createInventoryItem(data: InsertInventory): Promise<Inventory> {
    return this.post<Inventory>("/api/inventory", data);
  }

  public async updateInventoryItem(id: string, data: Partial<InsertInventory>): Promise<Inventory> {
    return this.put<Inventory>(`/api/inventory/${id}`, data);
  }

  public async deleteInventoryItem(id: string): Promise<void> {
    return this.delete<void>(`/api/inventory/${id}`);
  }

  public async importCatalog(items: any[], storeId: string): Promise<any> {
    return this.post<any>("/api/inventory/bulk-import", { items, storeId });
  }
}

export const inventoryApi = new InventoryApiService();
