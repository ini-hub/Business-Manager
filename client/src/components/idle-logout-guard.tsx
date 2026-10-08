import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, markIntentionalLogout, queryClient, SESSION_EXPIRED_PARAM, saveReturnPath } from "@/lib/queryClient";
import { getOfflineCheckouts } from "@/lib/offline-db";

// Signs an idle business user out. Shared POS tablets are left logged in at the till, and the session
// otherwise lasts a fixed 24h. Tune these two numbers; nothing else depends on them.
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const WARNING_MS = 2 * 60 * 1000;

const SHARED_KEY = "bm:lastActivity";
const TICK_MS = 5000;

// Activity is shared across tabs, so working in one tab never logs out the idle tab next to it.
function readSharedActivity(): number {
  try {
    return Number(localStorage.getItem(SHARED_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** True while checkouts are queued offline: signing out then would strand sales the user cannot see. */
async function hasUnsyncedSales(): Promise<boolean> {
  try {
    return (await getOfflineCheckouts()).length > 0;
  } catch {
    return false;
  }
}

export function IdleLogoutGuard() {
  const lastActivity = useRef(Date.now());
  const lastWrite = useRef(0);
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARNING_MS / 1000);
  const ending = useRef(false);

  const touch = useCallback(() => {
    const now = Date.now();
    lastActivity.current = now;
    if (now - lastWrite.current > 10_000) {
      lastWrite.current = now;
      try { localStorage.setItem(SHARED_KEY, String(now)); } catch { /* storage unavailable: tab-local only */ }
    }
  }, []);

  const signOut = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    saveReturnPath();
    markIntentionalLogout();
    try { await apiRequest("POST", "/api/auth/logout"); } catch { /* cookie may already be gone */ }
    queryClient.clear();
    window.location.replace(`/auth/login?${SESSION_EXPIRED_PARAM}=idle`);
  }, []);

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    // While the warning is up, only the button counts, so a stray mouse jiggle cannot dismiss it silently.
    const onActivity = () => { if (!warning) touch(); };
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [touch, warning]);

  useEffect(() => {
    touch();
    const id = setInterval(async () => {
      const last = Math.max(lastActivity.current, readSharedActivity());
      const idle = Date.now() - last;
      if (idle >= IDLE_TIMEOUT_MS) {
        if (await hasUnsyncedSales()) {
          // Hold the session open until the queue drains rather than discarding the warning flow.
          setWarning(false);
          touch();
          return;
        }
        void signOut();
      } else if (idle >= IDLE_TIMEOUT_MS - WARNING_MS) {
        setWarning(true);
        setSecondsLeft(Math.max(0, Math.ceil((IDLE_TIMEOUT_MS - idle) / 1000)));
      } else {
        setWarning(false);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [signOut, touch]);

  // Smooth the countdown between the 5s ticks.
  useEffect(() => {
    if (!warning) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [warning]);

  const stay = async () => {
    setWarning(false);
    touch();
    // Also proves the session is still valid; a 401 here routes through the expired-session handler.
    try { await apiRequest("GET", "/api/auth/user"); } catch { /* handled globally */ }
  };

  return (
    <Dialog open={warning} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm rounded-2xl p-6">
        <DialogHeader className="space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300 bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <DialogTitle className="text-center text-lg font-bold">Still there?</DialogTitle>
          <DialogDescription className="text-center text-sm">
            You have been inactive. For your security you will be signed out in:
          </DialogDescription>
        </DialogHeader>
        <div className="my-4 flex items-center justify-center gap-3 rounded-2xl border bg-muted p-4">
          <Clock className="h-6 w-6 text-primary" />
          <span className="font-mono text-3xl font-bold" aria-live="polite">
            {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, "0")}
          </span>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => void signOut()}>Sign out</Button>
          <Button className="flex-1" onClick={() => void stay()}>Stay signed in</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
