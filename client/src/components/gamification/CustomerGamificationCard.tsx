import { useQuery } from "@tanstack/react-query";
import { Trophy, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type GamificationSummary = {
  points: number;
  badges: { key: string; label: string; description: string }[];
  streak: { currentCount: number } | null;
};

export function CustomerGamificationCard({ storeId, customerId }: { storeId: string; customerId: string }) {
  const { data, isLoading } = useQuery<GamificationSummary>({
    queryKey: ["/api/gamification/summary", storeId, "customer", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/gamification/summary?storeId=${storeId}&subjectType=customer&subjectId=${customerId}`);
      if (!res.ok) throw new Error("Failed to load gamification summary");
      return res.json();
    },
    enabled: !!storeId && !!customerId,
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          Loyalty Achievements
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Gamification Points</span>
          <span className="font-bold text-sm">{data.points}</span>
        </div>
        {(data.streak?.currentCount ?? 0) > 0 && (
          <div className="flex items-center gap-2 text-xs text-orange-600">
            <Flame className="h-3.5 w-3.5" />
            {data.streak!.currentCount}-week visit streak
          </div>
        )}
        {data.badges.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {data.badges.map((b) => (
              <Badge key={b.key} variant="secondary" className="text-[11px]" title={b.description}>
                {b.label}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">No badges yet — badges unlock as this customer keeps visiting.</p>
        )}
      </CardContent>
    </Card>
  );
}
