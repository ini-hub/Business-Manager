import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfYear,
  endOfYear,
  addDays,
  subDays,
  addMonths,
  subMonths,
  addYears,
  subYears,
  isSameMonth,
  parseISO,
} from "date-fns";
import { useStore } from "@/lib/store-context";
import { STALE_TIMES } from "@/lib/queryClient";
import { CalendarPeriodNav, type CalendarPeriod } from "./CalendarPeriodNav";
import { CalendarTotalsBar } from "./CalendarTotalsBar";
import { DayAgendaView } from "./DayAgendaView";
import { MonthGridView } from "./MonthGridView";
import { YearMonthGrid } from "./YearMonthGrid";

interface SummaryBucket {
  bucket: string;
  count: number;
  revenue: number;
}

export function BookingCalendarView() {
  const { currentStore, stores } = useStore();
  const [, setLocation] = useLocation();
  const [period, setPeriod] = useState<CalendarPeriod>("month");
  const [anchorDate, setAnchorDate] = useState(new Date());

  const currency = currentStore?.currency || "NGN";
  const storeKey = currentStore?.id === "all"
    ? "all:" + stores.map((s) => s.id).join(",")
    : currentStore?.id;

  const handlePrev = () => {
    if (period === "day") setAnchorDate((d) => subDays(d, 1));
    else if (period === "month") setAnchorDate((d) => subMonths(d, 1));
    else setAnchorDate((d) => subYears(d, 1));
  };
  const handleNext = () => {
    if (period === "day") setAnchorDate((d) => addDays(d, 1));
    else if (period === "month") setAnchorDate((d) => addMonths(d, 1));
    else setAnchorDate((d) => addYears(d, 1));
  };
  const handleToday = () => setAnchorDate(new Date());

  const label =
    period === "day" ? format(anchorDate, "MMMM d, yyyy")
    : period === "month" ? format(anchorDate, "MMMM yyyy")
    : format(anchorDate, "yyyy");

  let rangeStart: string;
  let rangeEnd: string;
  if (period === "day") {
    rangeStart = rangeEnd = format(anchorDate, "yyyy-MM-dd");
  } else if (period === "month") {
    rangeStart = format(startOfWeek(startOfMonth(anchorDate)), "yyyy-MM-dd");
    rangeEnd = format(endOfWeek(endOfMonth(anchorDate)), "yyyy-MM-dd");
  } else {
    rangeStart = format(startOfYear(anchorDate), "yyyy-MM-dd");
    rangeEnd = format(endOfYear(anchorDate), "yyyy-MM-dd");
  }

  const detailQuery = useQuery<any[]>({
    queryKey: ["/api/bookings", "calendar-detail", storeKey, period, rangeStart, rangeEnd],
    queryFn: async () => {
      const fetchForStore = async (storeId: string, storeName?: string) => {
        try {
          const res = await fetch(`/api/bookings?storeId=${storeId}&startDate=${rangeStart}&endDate=${rangeEnd}&limit=2000`);
          if (!res.ok) return [];
          const payload = await res.json() as { data: any[] };
          const list = payload.data || [];
          return storeName ? list.map((item: any) => ({ ...item, storeName })) : list;
        } catch {
          return [];
        }
      };
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(stores.map((s) => fetchForStore(s.id, s.name)));
        return responses.flat();
      }
      if (!currentStore?.id) return [];
      return fetchForStore(currentStore.id);
    },
    enabled: period !== "year" && (currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id),
    staleTime: STALE_TIMES.transactional,
  });

  const summaryQuery = useQuery<SummaryBucket[]>({
    queryKey: ["/api/bookings", "summary", "month", storeKey, rangeStart, rangeEnd],
    queryFn: async () => {
      const fetchForStore = async (storeId: string) => {
        try {
          const res = await fetch(`/api/bookings/summary?storeId=${storeId}&groupBy=month&startDate=${rangeStart}&endDate=${rangeEnd}`);
          if (!res.ok) return [] as SummaryBucket[];
          const payload = await res.json() as { buckets: SummaryBucket[] };
          return payload.buckets || [];
        } catch {
          return [] as SummaryBucket[];
        }
      };
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(stores.map((s) => fetchForStore(s.id)));
        const merged = new Map<string, SummaryBucket>();
        for (const bucket of responses.flat()) {
          const existing = merged.get(bucket.bucket) ?? { bucket: bucket.bucket, count: 0, revenue: 0 };
          existing.count += bucket.count;
          existing.revenue += bucket.revenue;
          merged.set(bucket.bucket, existing);
        }
        return Array.from(merged.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
      }
      if (!currentStore?.id) return [];
      return fetchForStore(currentStore.id);
    },
    enabled: period === "year" && (currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id),
    staleTime: STALE_TIMES.transactional,
  });

  const detailData = detailQuery.data || [];
  const summaryBuckets = summaryQuery.data || [];

  const totals = (() => {
    if (period === "year") {
      return summaryBuckets.reduce(
        (acc, b) => ({ count: acc.count + b.count, revenue: acc.revenue + b.revenue }),
        { count: 0, revenue: 0 }
      );
    }
    const inScope = period === "month"
      ? detailData.filter((b: any) => isSameMonth(parseISO(b.scheduledAt), anchorDate))
      : detailData;
    return inScope.reduce(
      (acc: { count: number; revenue: number }, b: any) => ({
        count: acc.count + 1,
        revenue: acc.revenue + Number(b.totalPrice ?? 0),
      }),
      { count: 0, revenue: 0 }
    );
  })();

  const isLoading = period === "year" ? summaryQuery.isLoading : detailQuery.isLoading;

  return (
    <div className="space-y-4">
      <CalendarPeriodNav
        period={period}
        onPeriodChange={setPeriod}
        label={label}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />
      <CalendarTotalsBar
        count={totals.count}
        revenue={totals.revenue}
        currency={currency}
        label={period === "day" ? "Day" : period === "month" ? "Month" : "Year"}
        isLoading={isLoading}
      />
      {period === "day" && (
        <DayAgendaView
          bookings={detailData}
          currency={currency}
          onBookingClick={(id) => setLocation(`/bookings/${id}`)}
        />
      )}
      {period === "month" && (
        <MonthGridView
          anchorDate={anchorDate}
          bookings={detailData}
          currency={currency}
          onDayClick={(day) => {
            setAnchorDate(day);
            setPeriod("day");
          }}
          onBookingClick={(id) => setLocation(`/bookings/${id}`)}
        />
      )}
      {period === "year" && (
        <YearMonthGrid
          anchorDate={anchorDate}
          buckets={summaryBuckets}
          currency={currency}
          onSelectMonth={(monthDate) => {
            setAnchorDate(monthDate);
            setPeriod("month");
          }}
        />
      )}
    </div>
  );
}
