import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./queryClient";
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
  deleteStore: (id: string) => Promise<void>;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const STORAGE_KEY = "selectedStoreId";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [currentStore, setCurrentStoreState] = useState<Store | null>(null);

  const { data: business, isLoading: businessLoading } = useQuery<Business | null>({
    queryKey: ["/api/business"],
  });

  const { data: stores = [], isLoading: storesLoading } = useQuery<Store[]>({
    queryKey: ["/api/stores", business?.id],
    enabled: !!business?.id,
  });

  useEffect(() => {
    if (stores.length > 0 && !currentStore) {
      const savedStoreId = localStorage.getItem(STORAGE_KEY);
      const savedStore = stores.find(s => s.id === savedStoreId);
      setCurrentStoreState(savedStore || stores[0]);
    }
  }, [stores, currentStore]);

  const setCurrentStore = (store: Store) => {
    setCurrentStoreState(store);
    localStorage.setItem(STORAGE_KEY, store.id);
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
