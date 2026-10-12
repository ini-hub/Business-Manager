import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Store } from "lucide-react";

type Assignment = {
  storeId: string;
  storeName: string;
  staffNumber: string;
  role: string;
  isArchived: boolean;
  isHome: boolean;
};

/** The stores one staff member works in: the home store (pay and payroll) and any additional stores. */
export function StaffStoresCard({ staffId }: { staffId: string }) {
  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: [`/api/staff/${staffId}/assignments`],
    enabled: !!staffId,
  });
  // One store is the ordinary case and says nothing new; the card earns its space only for a multi-store person.
  if (assignments.length < 2) return null;

  return (
    <Card className="glassmorphism border border-border/80" data-testid="card-staff-stores">
      <CardHeader className="pb-3 border-b">
        <CardTitle className="flex items-center gap-2">
          <Store className="h-4 w-4" /> Works at
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <ul className="divide-y">
          {assignments.map((a) => (
            <li key={a.storeId} className="flex items-center justify-between py-2 text-sm" data-testid={`assignment-${a.storeId}`}>
              <span className="font-medium">{a.storeName}</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span>{a.staffNumber}</span>
                {a.isHome && <Badge>Home store</Badge>}
                {a.isArchived && <Badge variant="secondary">Archived</Badge>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
