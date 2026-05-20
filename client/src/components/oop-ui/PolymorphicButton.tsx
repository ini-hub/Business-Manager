import * as React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export interface PolymorphicButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  as?: "button" | "a" | typeof Link;
  href?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

export const PolymorphicButton = React.forwardRef<any, PolymorphicButtonProps>(
  ({ className, as, href, variant = "default", size = "default", ...props }, ref) => {
    const Component = as || (href ? (href.startsWith("http") ? "a" : Link) : "button");
    const dynamicProps = href ? { href } : {};

    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...dynamicProps}
        {...(props as any)}
      />
    );
  }
);

PolymorphicButton.displayName = "PolymorphicButton";
