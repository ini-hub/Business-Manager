import { createPortal } from "react-dom";
import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpeedDialAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  testId?: string;
}

interface SpeedDialFABProps {
  actions: SpeedDialAction[];
}

const FAB_SIZE = 56;          // h-14 w-14 in px
const STORAGE_KEY = "speed-dial-fab-pos";
const DRAG_THRESHOLD = 6;     // px moved before a tap becomes a drag

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function defaultPosition() {
  return {
    x: window.innerWidth - FAB_SIZE - 24,
    y: window.innerHeight - FAB_SIZE - 24,
  };
}

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { x, y } = JSON.parse(raw);
      // Re-clamp in case viewport changed since last save
      return {
        x: clamp(x, 0, window.innerWidth - FAB_SIZE),
        y: clamp(y, 0, window.innerHeight - FAB_SIZE),
      };
    }
  } catch {}
  return defaultPosition();
}

export function SpeedDialFAB({ actions }: SpeedDialFABProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>(defaultPosition);

  // Load persisted position after mount (window not available during SSR)
  useEffect(() => {
    setPos(loadPosition());
  }, []);

  // Re-clamp if viewport resizes
  useEffect(() => {
    const onResize = () =>
      setPos((p) => ({
        x: clamp(p.x, 0, window.innerWidth - FAB_SIZE),
        y: clamp(p.y, 0, window.innerHeight - FAB_SIZE),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isDragging = useRef(false);
  const dragStart = useRef({ px: 0, py: 0, bx: 0, by: 0 }); // pointer start, button start
  const totalMove = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.currentTarget.setPointerCapture(e.pointerId);
      isDragging.current = true;
      totalMove.current = 0;
      dragStart.current = {
        px: e.clientX,
        py: e.clientY,
        bx: pos.x,
        by: pos.y,
      };
      // Close actions when starting to drag
      if (open) setOpen(false);
    },
    [pos, open]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDragging.current) return;
      const dx = e.clientX - dragStart.current.px;
      const dy = e.clientY - dragStart.current.py;
      totalMove.current = Math.sqrt(dx * dx + dy * dy);
      const newX = clamp(
        dragStart.current.bx + dx,
        0,
        window.innerWidth - FAB_SIZE
      );
      const newY = clamp(
        dragStart.current.by + dy,
        0,
        window.innerHeight - FAB_SIZE
      );
      setPos({ x: newX, y: newY });
    },
    []
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!isDragging.current) return;
      isDragging.current = false;

      if (totalMove.current < DRAG_THRESHOLD) {
        // It was a tap — toggle menu
        setOpen((v) => !v);
      } else {
        // It was a drag — persist final position
        setPos((p) => {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
          return p;
        });
      }
    },
    []
  );

  if (actions.length === 0) return null;

  const handleAction = (onClick: () => void) => {
    setOpen(false);
    onClick();
  };

  // Decide whether action menu expands up or down based on vertical position
  const expandDown = pos.y < window.innerHeight / 2;

  return createPortal(
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[9990] bg-black/20 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* FAB container — absolutely positioned */}
      <div
        className="fixed z-[9999]"
        style={{ left: pos.x, top: pos.y, width: FAB_SIZE, height: FAB_SIZE }}
      >
        {/* Action items */}
        <div
          className={cn(
            "absolute flex flex-col items-end gap-3",
            expandDown
              ? "top-full mt-3"         // expand downward
              : "bottom-full mb-3"      // expand upward (default)
          )}
          style={{ right: 0 }}
        >
          {actions.map((action, index) => {
            const reverseIndex = actions.length - 1 - index;
            const delay = open
              ? `${reverseIndex * 60}ms`
              : `${index * 30}ms`;
            return (
              <div
                key={action.label}
                className={cn(
                  "flex items-center gap-3 transition-all duration-200",
                  open
                    ? "opacity-100 translate-y-0 pointer-events-auto"
                    : "opacity-0 translate-y-4 pointer-events-none"
                )}
                style={{ transitionDelay: delay }}
              >
                <span className="bg-white dark:bg-gray-800 text-foreground text-sm font-medium px-3 py-1.5 rounded-full shadow-lg border border-border whitespace-nowrap select-none">
                  {action.label}
                </span>
                <button
                  data-testid={action.testId}
                  onClick={() => handleAction(action.onClick)}
                  className="h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-110 hover:bg-primary/90 transition-all duration-150 active:scale-95"
                >
                  {action.icon}
                </button>
              </div>
            );
          })}
        </div>

        {/* Main button */}
        <button
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={cn(
            "h-14 w-14 rounded-full bg-primary text-primary-foreground",
            "shadow-2xl shadow-primary/30 flex items-center justify-center",
            "hover:scale-105 hover:bg-primary/95 active:scale-95",
            "transition-all duration-200 border border-white/10",
            "touch-none select-none cursor-grab active:cursor-grabbing"
          )}
          aria-label={open ? "Close speed dial" : "Open speed dial"}
        >
          <Plus
            className={cn(
              "h-6 w-6 transition-transform duration-300",
              open && "rotate-45"
            )}
          />
        </button>
      </div>
    </>,
    document.body
  );
}
