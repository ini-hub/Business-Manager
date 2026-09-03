import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { Business, Store, InsertBusiness, InsertStore } from "@shared/schema";

interface StoreContextType {
  business: Business | null;
  stores: Store[];
  currentStore: Store | null;
  setCurrentStore: (store: Store) => void;
  isLoading: boolean;
  createBusiness: (data: InsertBusiness) => Promise<Business>;
  updateBusiness: (id: string, data: Partial<InsertBusiness>) => Promise<Business>;
  createStore: (data: InsertStore) => Promise<Store>;
  updateStore: (id: string, data: Partial<InsertStore>) => Promise<Store>;
  archiveStore: (id: string) => Promise<Store>;
  restoreStore: (id: string) => Promise<Store>;
  deleteStore: (id: string) => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const STORAGE_KEY = "selectedStoreId";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [currentStore, setCurrentStoreState] = useState<Store | null>(null);
  const { user } = useAuth();

  // Scope localStorage key per-user so different accounts don't share state
  const storageKey = user?.id ? `selectedStoreId_${user.id}` : null;

  const { data: business, isLoading: businessLoading } = useQuery<Business | null>({
    queryKey: ["/api/business"],
  });

  const { data: stores = [], isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores", business?.id],
    enabled: !!business?.id,
  });

  // An archived store must never become (or stay) the selected "current
  // store" - it's hidden from day-to-day operation, only reachable from the
  // store management settings page.
  const activeStores = useMemo(() => stores.filter(s => s.isActive !== false), [stores]);

  useEffect(() => {
    if (activeStores.length > 0) {
      const savedStoreId = storageKey ? localStorage.getItem(storageKey) : null;
      // Only use saved store if it actually belongs to this user's active stores or is the special "all" view for owners
      if (savedStoreId === "all" && user?.role === "owner") {
        setCurrentStoreState({
          id: "all",
          name: "All Stores (Consolidated)",
          currency: activeStores[0]?.currency || "NGN",
          code: "GLOBAL",
          businessId: business?.id,
        } as any);
      } else {
        const savedStore = savedStoreId ? activeStores.find(s => s.id === savedStoreId) : null;
        setCurrentStoreState(savedStore || activeStores[0]);
      }
    }
  }, [activeStores, storageKey, user, business]);

  const setCurrentStore = (store: Store) => {
    setCurrentStoreState(store);
    if (storageKey) localStorage.setItem(storageKey, store.id);
    queryClient.invalidateQueries();
  };

  const createBusinessMutation = useMutation({
    mutationFn: async (data: InsertBusiness) => {
      const res = await apiRequest("POST", "/api/business", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business"] });
    },
  });

  const updateBusinessMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertBusiness> }) => {
      const res = await apiRequest("PATCH", `/api/business/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business"] });
    },
  });

  const createStoreMutation = useMutation({
    mutationFn: async (data: InsertStore) => {
      const res = await apiRequest("POST", "/api/stores", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores", business?.id] });
    },
  });

  const updateStoreMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertStore> }) => {
      const res = await apiRequest("PATCH", `/api/stores/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores", business?.id] });
    },
  });

  const deleteStoreMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/stores/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores", business?.id] });
    },
  });

  const archiveStoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/stores/${id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores", business?.id] });
    },
  });

  const restoreStoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/stores/${id}/restore`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stores", business?.id] });
    },
  });

  const value: StoreContextType = {
    business: business || null,
    stores,
    currentStore,
    setCurrentStore,
    isLoading: businessLoading || storesLoading,
    createBusiness: createBusinessMutation.mutateAsync,
    updateBusiness: (id, data) => updateBusinessMutation.mutateAsync({ id, data }),
    createStore: createStoreMutation.mutateAsync,
    updateStore: (id, data) => updateStoreMutation.mutateAsync({ id, data }),
    archiveStore: archiveStoreMutation.mutateAsync,
    restoreStore: restoreStoreMutation.mutateAsync,
    deleteStore: deleteStoreMutation.mutateAsync,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (context === undefined) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
}
