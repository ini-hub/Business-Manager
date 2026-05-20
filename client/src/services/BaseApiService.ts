import { apiRequest } from "@/lib/queryClient";

export class BaseApiService {
  protected async get<T>(url: string): Promise<T> {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return await res.json();
  }

  protected async post<T>(url: string, data?: any): Promise<T> {
    const res = await apiRequest("POST", url, data);
    return await res.json();
  }

  protected async put<T>(url: string, data?: any): Promise<T> {
    const res = await apiRequest("PUT", url, data);
    return await res.json();
  }

  protected async delete<T>(url: string): Promise<T> {
    const res = await apiRequest("DELETE", url);
    if (res.status === 204) return {} as T;
    return await res.json();
  }
}
