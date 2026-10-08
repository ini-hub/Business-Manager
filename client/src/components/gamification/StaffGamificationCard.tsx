import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type GamificationSummary = {
  points: number;
  badges: { key: string; label: string; description: string }[];
};

export function StaffGamificationCard({ storeId, staffId }: { storeId: string; staffId: string }) {
  const { data, isLoading } = useQuery<GamificationSummary>({
    queryKey: ["/api/gamification/summary", storeId, "staff", staffId],
    queryFn: async () => {
      const res = await fetch(`/api/gamification/summary?storeId=${storeId}&subjectType=staff&subjectId=${staffId}`);
      if (!res.ok) throw new Error("Failed to load gamification summary");
      return res.json();
    },
    enabled: !!storeId && !!staffId,
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          Achievements
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Gamification Points</span>
          <span className="font-bold text-sm">{data.points}</span>
        </div>
        {data.badges.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {data.badges.map((b) => (
              <Badge key={b.key} variant="secondary" title={b.description}>{b.label}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No badges earned yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
