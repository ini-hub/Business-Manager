import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    
    // Try to parse JSON error response and extract just the message
    try {
      const jsonError = JSON.parse(text);
      const errorMessage = jsonError.message || jsonError.error || text;
      throw new Error(errorMessage);
    } catch (parseError) {
      // If not JSON, use the text directly (without status code prefix)
      if (parseError instanceof SyntaxError) {
        throw new Error(text || res.statusText);
      }
      throw parseError;
    }
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = queryKey[0] as string;
    const secondParam = queryKey[1] as string | undefined;
    const thirdParam = queryKey[2] as string | undefined;
    
    let url = baseUrl;
    if (secondParam) {
      if (thirdParam) {
        url = `${baseUrl}/${secondParam}/${thirdParam}`;
      } else {
        const separator = baseUrl.includes("?") ? "&" : "?";
        // Use businessId for /api/stores, storeId for everything else
        const paramName = baseUrl === "/api/stores" ? "businessId" : "storeId";
        url = `${baseUrl}${separator}${paramName}=${secondParam}`;
      }
    }

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      staleTime: 5 * 60 * 1000, // 5 min — data stays fresh, no unnecessary refetches
      gcTime: 10 * 60 * 1000, // 10 min — keep in cache after unmount
      refetchOnWindowFocus: false, // disable focus-refetch noise
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

