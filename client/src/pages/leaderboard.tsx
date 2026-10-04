import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Medal, Award, Users, UserCog } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { badgesForSubject } from "@shared/gamification/badges";

type LeaderboardEntry = { subjectId: string; name: string; points: number };

const RANK_STYLES = [
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
];

function LeaderboardList({ entries, isLoading, emptyLabel }: { entries: LeaderboardEntry[]; isLoading: boolean; emptyLabel: string }) {
  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">{emptyLabel}</p>;
  }
  return (
    <div className="divide-y">
      {entries.map((entry, i) => (
        <div key={entry.subjectId} className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${RANK_STYLES[i] ?? "bg-muted text-muted-foreground"}`}>
              {i + 1}
            </div>
            <span className="font-medium text-sm">{entry.name}</span>
          </div>
          <span className="font-bold text-sm tabular-nums">{entry.points} pts</span>
        </div>
      ))}
    </div>
  );
}

function BadgeCatalogue({ subjectType }: { subjectType: "customer" | "staff" | "owner" }) {
  const badges = badgesForSubject(subjectType);
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((b) => (
        <Badge key={b.key} variant="outline" className="text-xs" title={b.description}>
          {b.label}
        </Badge>
      ))}
    </div>
  );
}

export default function LeaderboardPage() {
  const { currentStore } = useStore();
  const [tab, setTab] = useState<"staff" | "customer">("staff");

  const isAllStores = !currentStore || currentStore.id === "all";

  const { data: staffLeaderboard = [], isLoading: staffLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/gamification/leaderboard", currentStore?.id, "staff"],
    queryFn: async () => {
      const res = await fetch(`/api/gamification/leaderboard?storeId=${currentStore?.id}&subjectType=staff`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !isAllStores,
  });

  const { data: customerLeaderboard = [], isLoading: customerLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/gamification/leaderboard", currentStore?.id, "customer"],
    queryFn: async () => {
      const res = await fetch(`/api/gamification/leaderboard?storeId=${currentStore?.id}&subjectType=customer`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !isAllStores,
  });

  if (!currentStore) {
    return <StoreRequiredAlert />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaderboard"
        description="Points, streaks and badges for staff and customers"
        compact
      />

      {isAllStores ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Select a single store to see its leaderboard — points are tracked per store.
          </CardContent>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "staff" | "customer")}>
          <TabsList>
            <TabsTrigger value="staff" className="gap-2">
              <UserCog className="h-3.5 w-3.5" /> Staff
            </TabsTrigger>
            <TabsTrigger value="customer" className="gap-2">
              <Users className="h-3.5 w-3.5" /> Customers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="staff" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="h-4 w-4 text-amber-500" /> Top Staff
                </CardTitle>
                <CardDescription>Ranked by points earned from sales and on-time shifts</CardDescription>
              </CardHeader>
              <CardContent>
                <LeaderboardList entries={staffLeaderboard} isLoading={staffLoading} emptyLabel="No staff points recorded yet." />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Award className="h-4 w-4" /> Badges Staff Can Earn
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BadgeCatalogue subjectType="staff" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customer" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Medal className="h-4 w-4 text-amber-500" /> Top Customers
                </CardTitle>
                <CardDescription>Ranked by points earned from visits</CardDescription>
              </CardHeader>
              <CardContent>
                <LeaderboardList entries={customerLeaderboard} isLoading={customerLoading} emptyLabel="No customer points recorded yet." />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Award className="h-4 w-4" /> Badges Customers Can Earn
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BadgeCatalogue subjectType="customer" />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
