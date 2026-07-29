import React from "react";
import { useLocation, useSearch } from "wouter";
import { buildSlug } from "@/lib/slug";
import { appendReturnTo } from "@/lib/return-to";
import { cn } from "@/lib/utils";

/**
 * Interface representing a displayable entity (OOP principle: Interface Segregation & Dependency Inversion)
 */
export interface IDisplayableEntity {
  getName(): string;
  getIdentifier(): string;
  getSecondaryNumber(): string | null | undefined;
  renderVisual(): React.ReactNode;
}

/**
 * Abstract base class for Display Presenters (OOP principle: Polymorphism, Inheritance & Encapsulation)
 */
export abstract class BaseEntityPresenter implements IDisplayableEntity {
  protected name: string;
  protected identifier: string;
  protected secondaryNumber?: string | null;

  constructor(name: string, identifier: string, secondaryNumber?: string | null) {
    this.name = name;
    this.identifier = identifier;
    this.secondaryNumber = secondaryNumber;
  }

  getName(): string {
    return this.name || "Unknown";
  }

  getIdentifier(): string {
    return this.identifier || "—";
  }

  getSecondaryNumber(): string | null | undefined {
    return this.secondaryNumber;
  }

  /**
   * Encapsulates the visual presentation layout.
   * Matches the standard layout (Customer field in new sales):
   * Name: font-semibold text-sm
   * ID / Number: text-xs text-muted-foreground font-mono
   */
  renderVisual(): React.ReactNode {
    const sec = this.getSecondaryNumber();
    return (
      <div className="flex flex-col text-left">
        <span className="font-semibold text-sm text-foreground">{this.getName()}</span>
        <span className="text-xs text-muted-foreground font-mono">
          {this.getIdentifier()}{sec ? ` • ${sec}` : ""}
        </span>
      </div>
    );
  }
}

/**
 * Specialized Presenter for Customers
 */
export class CustomerPresenter extends BaseEntityPresenter {
  private isStaff: boolean;

  constructor(customer: { name: string; customerNumber: string; mobileNumber?: string | null; staffId?: string | null }) {
    super(customer.name, customer.customerNumber, customer.mobileNumber);
    this.isStaff = !!customer.staffId;
  }

  override renderVisual(): React.ReactNode {
    const sec = this.getSecondaryNumber();
    return (
      <div className="flex flex-col text-left">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm text-foreground">{this.getName()}</span>
          {this.isStaff && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 leading-none">
              Staff
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          {this.getIdentifier()}{sec ? ` • ${sec}` : ""}
        </span>
      </div>
    );
  }
}

/**
 * Specialized Presenter for Staff Members
 */
export class StaffPresenter extends BaseEntityPresenter {
  constructor(staff: { name: string; staffNumber: string }) {
    super(staff.name, staff.staffNumber, null);
  }
}

/**
 * Reusable React Component that delegates rendering to the OOP Presenter instance
 */
interface EntityDisplayProps {
  presenter: IDisplayableEntity;
}

export const EntityDisplay: React.FC<EntityDisplayProps> = ({ presenter }) => {
  return <>{presenter.renderVisual()}</>;
};

/**
 * Generic click-through wrapper for a nested entity reference: navigates to `href` carrying
 * a `returnTo` (so the destination's Back button lands right back where this was clicked),
 * and stops propagation so it can be nested inside a row that has its own `onRowClick` for a
 * different destination without triggering it.
 */
interface EntityLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
}

export const EntityLink: React.FC<EntityLinkProps> = ({ href, className, children }) => {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const target = appendReturnTo(href, location, search);

  const navigate = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    setLocation(target);
  };

  return (
    <span
      role="link"
      tabIndex={0}
      className={cn("cursor-pointer hover:underline", className)}
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(e);
      }}
    >
      {children}
    </span>
  );
};

/**
 * Renders a customer reference embedded in another entity's row (transaction, booking,
 * credit sale, quote, ...) as a click-through to that customer's detail page, carrying
 * a `returnTo` so the customer page's Back button lands the user right back on this row's
 * page. Falls back to a plain (non-clickable) presenter when no customer id is known at all
 * (e.g. a quote with no linked customer).
 */
interface CustomerLinkProps {
  customer?: {
    id: string;
    name: string;
    customerNumber?: string | null;
    mobileNumber?: string | null;
    staffId?: string | null;
  } | null;
  customerId?: string | null;
  fallbackName?: string;
}

export const CustomerLink: React.FC<CustomerLinkProps> = ({ customer, customerId, fallbackName = "Unknown" }) => {
  const id = customer?.id ?? customerId ?? null;
  const presenter = new CustomerPresenter({
    name: customer?.name || fallbackName,
    customerNumber: customer?.customerNumber || customerId || "—",
    mobileNumber: customer?.mobileNumber,
    staffId: customer?.staffId,
  });

  if (!id) {
    return <EntityDisplay presenter={presenter} />;
  }

  return (
    <EntityLink href={`/customers/${buildSlug(customer?.name || fallbackName, id)}`}>
      {presenter.renderVisual()}
    </EntityLink>
  );
};
