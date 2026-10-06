import { cloneElement, isValidElement, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useEntitlements, formatPrice } from "@/hooks/useEntitlements";
import { announcePlanLimit } from "@/lib/upgrade-prompt";

/**
 * The one rule for an entitled-by-flag feature, usable on any button, tab or section:
 *   - flag off (disabled)  -> renders nothing
 *   - on and paid/trialing -> renders children untouched
 *   - on but unpaid        -> renders children visibly, but a click is swallowed and
 *                             the upgrade dialog says what the feature costs
 *   - still loading/failed -> renders children (the server is authoritative; a failed
 *                             fetch must not look like "locked")
 * Use `hideWhenLocked` for options that live inside another flow (credit tender,
 * credit tab, transfer-to-store): there the unpaid state is hidden, not teased.
 */
export function useGate(featureKey: string | undefined) {
  const { hasFeature, isDisabled, isLocked, priceFor, isLoading, isError } = useEntitlements();
  if (!featureKey || isLoading || isError) return { state: "open" as const, locked: false, price: undefined, announce: () => {} };
  const state = isDisabled(featureKey) ? ("hidden" as const) : isLocked(featureKey) && !hasFeature(featureKey) ? ("locked" as const) : ("open" as const);
  const price = priceFor(featureKey);
  const announce = () =>
    announcePlanLimit({
      kind: "feature",
      featureKey,
      featureName: price?.name,
      priceMonthly: price?.monthly,
      currency: price?.currency,
      message: formatPrice(price)
        ? `${price?.name ?? "This feature"} costs ${formatPrice(price)}. Add it from Settings > Billing to continue.`
        : `${price?.name ?? "This feature"} isn't included in your plan yet. Add it from Settings > Billing to continue.`,
    });
  return { state, locked: state === "locked", price, announce };
}

/**
 * For menus/lists of actions that each name a `gate` feature: drops the ones whose flag is off
 * (and, with `hideWhenLocked`, the unpaid ones), and turns a click on an unpaid one into the
 * priced upgrade prompt. Actions without a gate pass through untouched.
 */
export function useGatedActions<A extends { gate?: string; hideWhenLocked?: boolean; onClick: () => void }>(actions: A[]): A[] {
  const { hasFeature, isDisabled, isLocked, priceFor, isLoading, isError } = useEntitlements();
  if (isLoading || isError) return actions;
  return actions.flatMap((a) => {
    if (!a.gate) return [a];
    if (isDisabled(a.gate)) return [];
    if (!isLocked(a.gate) || hasFeature(a.gate)) return [a];
    if (a.hideWhenLocked) return [];
    const price = priceFor(a.gate);
    const label = formatPrice(price);
    const name = price?.name ?? "This feature";
    return [{
      ...a,
      onClick: () =>
        announcePlanLimit({
          kind: "feature",
          featureKey: a.gate,
          featureName: price?.name,
          priceMonthly: price?.monthly,
          currency: price?.currency,
          message: label ? `${name} costs ${label}. Add it from Settings > Billing to continue.` : `${name} isn't included in your plan yet. Add it from Settings > Billing to continue.`,
        }),
    }];
  });
}

export function Gated({
  feature,
  children,
  hideWhenLocked = false,
}: {
  feature: string | undefined;
  children: ReactNode;
  hideWhenLocked?: boolean;
}) {
  const { state, announce } = useGate(feature);
  if (state === "hidden" || (hideWhenLocked && state === "locked")) return null;
  if (state === "open") return <>{children}</>;
  if (!isValidElement(children)) return <>{children}</>;

  const el = children as ReactElement<any>;
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    announce();
  };
  return cloneElement(el, {
    onClick: swallow,
    onSelect: (e: Event) => { e.preventDefault(); announce(); },
    "aria-disabled": true,
    "data-locked": "true",
    type: el.props.type === "submit" ? "button" : el.props.type,
  });
}
