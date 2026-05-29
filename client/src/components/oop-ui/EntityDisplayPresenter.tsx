import React from "react";

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
  constructor(customer: { name: string; customerNumber: string; mobileNumber?: string | null }) {
    super(customer.name, customer.customerNumber, customer.mobileNumber);
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
