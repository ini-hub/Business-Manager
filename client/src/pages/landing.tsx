import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Store, Users, Package, Coins, BarChart3, Shield } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/50">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Business Management System
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Manage your multi-store business with ease. Track customers, staff, inventory, 
            sales, and analyze profit/loss - all in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/auth/login">
              <Button size="lg" data-testid="button-login">
                Sign In
              </Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="lg" variant="outline" data-testid="button-signup">
                Create Account
              </Button>
            </Link>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            Or{" "}
            <button 
              onClick={() => window.location.href = "/api/login"} 
              className="text-primary hover:underline"
              data-testid="button-replit-login"
            >
              continue with Replit
            </button>
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
          <Card>
            <CardHeader>
              <Store className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Multi-Store Support</CardTitle>
              <CardDescription>
                Manage multiple store locations with individual settings and data
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Users className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Customer & Staff Management</CardTitle>
              <CardDescription>
                Track customer relationships and manage staff with auto-generated IDs
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Package className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Inventory Control</CardTitle>
              <CardDescription>
                Products and services with stock tracking, restocking, and pricing
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Coins className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Sales & Transactions</CardTitle>
              <CardDescription>
                Process sales with multiple payment methods and negotiable pricing
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <BarChart3 className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Profit/Loss Analytics</CardTitle>
              <CardDescription>
                Automated profit calculations with visual reports and trends
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Secure & Reliable</CardTitle>
              <CardDescription>
                User authentication, data encryption, and secure transactions
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}
