import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { useStore } from "@/lib/store-context";

const LOOKBACK_DAYS = 90;

/**
 * Whether the staff member's store keeps attendance at all, so screens that are
 * only about attendance can step aside when it doesn't.
 *
 * Self clock-in being off isn't enough to say no: a manager can still record
 * attendance on staff's behalf, and payroll reads those records. So a store counts
 * as tracking when self clock-in is on, or when this person has any attendance
 * record in the last 90 days. While either answer is still loading it reports
 * true, so nav items and tiles don't pop in and out on first paint.
 */
export function useAttendanceTracked(enabled = true) {
  const { currentStore } = useStore();
  const storeId = currentStore?.id;
  const on = enabled && !!storeId && storeId !== "all";

  // Same key the clock-in card uses, so this costs no extra request.
  const { data: today, isLoading: todayLoading } = useQuery<{ clockInEnabled: boolean }>({
    queryKey: ["/api/attendance/today", storeId],
    enabled: on,
  });

  const selfClockIn = !!today?.clockInEnabled;
  const startDate = format(subDays(new Date(), LOOKBACK_DAYS), "yyyy-MM-dd");
  const endDate = format(new Date(), "yyyy-MM-dd");

  const { data: log, isLoading: logLoading } = useQuery<{ totalGroups: number }>({
    queryKey: ["/api/attendance/log", storeId, "has-records", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance/log?storeId=${storeId}&startDate=${startDate}&endDate=${endDate}&page=1&pageSize=1&self=1`,
        { credentials: "include" },
      );
      return res.ok ? res.json() : { totalGroups: 0 };
    },
    enabled: on && !todayLoading && !selfClockIn,
  });

  if (!on) return { tracked: true, isLoading: false };
  if (todayLoading) return { tracked: true, isLoading: true };
  if (selfClockIn) return { tracked: true, isLoading: false };
  if (logLoading || !log) return { tracked: true, isLoading: true };
  return { tracked: log.totalGroups > 0, isLoading: false };
}
