import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Bell, Package, Receipt, AlertCircle, Check, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, parseISO } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function playNotificationSound() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // First chime: beautiful clear bell tone (D5)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    gain1.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.4);
    
    // Second chime: harmonizing high ping (A5), delayed slightly for standard notification texture
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.12); // A5
    gain2.gain.setValueAtTime(0.10, audioCtx.currentTime + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
    osc2.start(audioCtx.currentTime + 0.12);
    osc2.stop(audioCtx.currentTime + 0.5);
  } catch (error) {
    console.warn("Audio Context playback failed or blocked:", error);
  }
}

export function NotificationSheet() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/notifications"],
    enabled: !!user,
    refetchInterval: 60000, // 1-min fallback poll; live updates come via the shared WS in useRealtimeSync
  });

  const prevCountRef = useRef<number | null>(null);

  useEffect(() => {
    // Only play sound if notifications query was initialized and count has increased
    if (prevCountRef.current !== null && notifications.length > prevCountRef.current) {
      playNotificationSound();
    }
    prevCountRef.current = notifications.length;
  }, [notifications.length]);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/read-all", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  useEffect(() => {
    // Only play sound if notifications query was initialized and unread count has increased
    if (prevCountRef.current !== null && unreadCount > prevCountRef.current) {
      playNotificationSound();
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount]);

  const getIcon = (type: string) => {
    switch (type) {
      case "low_stock": return <Package className="h-4 w-4 text-orange-500" />;
      case "void_transaction": return <Receipt className="h-4 w-4 text-red-500" />;
      default: return <AlertCircle className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center p-0 text-[10px]"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-6 border-b">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <SheetTitle>Notifications</SheetTitle>
              <SheetDescription>
                Activity log and system notifications
              </SheetDescription>
            </div>
            {unreadCount > 0 && (
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs h-8 text-primary border-primary/20 hover:bg-primary/5"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
              >
                Mark all as read
              </Button>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground p-8 text-center space-y-2">
              <Check className="h-12 w-12 opacity-10" />
              <p className="text-sm font-medium">All caught up!</p>
              <p className="text-xs">No notifications at the moment.</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <div 
                  key={n.id} 
                  className={cn(
                    "p-4 group hover:bg-muted/50 transition-all duration-200",
                    n.isRead ? "opacity-60 bg-muted/10" : "bg-card"
                  )}
                >
                  <div className="flex gap-4">
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                      n.isRead ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                    )}>
                      {getIcon(n.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {n.type.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(parseISO(n.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm mt-1 leading-tight">{n.message}</p>
                      
                      {!n.isRead ? (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 mt-2 text-[10px] px-2 hover:bg-primary/10 hover:text-primary"
                          onClick={() => markReadMutation.mutate(n.id)}
                          disabled={markReadMutation.isPending}
                        >
                          Mark as read
                        </Button>
                      ) : (
                        <span className="inline-flex items-center gap-1 mt-2 text-[9px] text-muted-foreground font-medium">
                          <Check className="h-3 w-3 text-emerald-500" /> Read
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
