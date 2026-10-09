import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/loader";

export interface MyContractData {
  contractStatus: "none" | "pending_signature" | "signed" | "declined";
  awaitingResignature: boolean;
  copies: Array<{
    versionNumber: number;
    isCurrent: boolean;
    contractType: "file" | "image" | "text";
    contentText?: string | null;
    fileOriginalName?: string | null;
    altText?: string | null;
    signedGetUrl?: string;
    signedAt: string;
    typedFullName: string;
    contentHash: string;
  }>;
}

export const MY_CONTRACT_QUERY_KEY = ["/api/contract/mine"];

export function useMyContract(enabled = true) {
  return useQuery<MyContractData>({
    queryKey: MY_CONTRACT_QUERY_KEY,
    enabled,
    queryFn: async () => (await apiRequest("GET", "/api/contract/mine")).json(),
  });
}

/** The signed-in staff member's own signed contract(s): only versions they signed are ever shown. */
export function MyContractTab() {
  const { data, isLoading } = useMyContract();

  if (isLoading) {
    return <div className="flex justify-center py-8"><Spinner className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!data || data.copies.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">You haven't signed a contract yet.</p>;
  }

  return (
    <div className="space-y-3">
      {data.awaitingResignature && (
        <p className="text-sm rounded-md border border-primary/20 bg-primary/5 p-3">
          Your employer has updated your contract. You'll be asked to sign the new version the next time you log in.
        </p>
      )}
      {data.copies.map((c) => (
        <Card key={c.versionNumber} className="border-0 shadow-sm" data-testid={`my-contract-v${c.versionNumber}`}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Version {c.versionNumber}</span>
              <Badge variant={c.isCurrent && !data.awaitingResignature ? "default" : "secondary"}>
                {c.isCurrent && !data.awaitingResignature ? "Current" : "Superseded"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Signed by {c.typedFullName} on {new Date(c.signedAt).toLocaleString()}
            </p>
            {c.contractType === "text" && c.contentText && (
              <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded p-3 max-h-64 overflow-y-auto">{c.contentText}</pre>
            )}
            {c.contractType === "image" && c.signedGetUrl && (
              <img src={c.signedGetUrl} alt={c.altText || "Signed contract"} className="max-w-full rounded border" />
            )}
            {c.contractType === "file" && c.signedGetUrl && (
              <a href={c.signedGetUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline block">
                View {c.fileOriginalName || "signed document"}
              </a>
            )}
            <p className="text-[11px] text-muted-foreground break-all">Fingerprint (SHA-256): {c.contentHash}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
