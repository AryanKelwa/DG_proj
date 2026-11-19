"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Calculator,
  Kanban,
  UserCheck,
  Menu,
  X,
  LayoutGrid,
} from "lucide-react";

export function Navbar() {
  const { role, user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white font-heading font-extrabold text-xs shadow-sm group-hover:scale-105 transition-all">
                W2P
              </div>
              <div className="flex flex-col">
                <span className="font-heading font-extrabold text-lg tracking-tight text-foreground leading-none">
                  W2P
                </span>
                <span className="text-[10px] tracking-wider text-muted-foreground uppercase mt-0.5 font-medium">
                  Web-to-Print Platform
                </span>
              </div>
            </Link>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-5 text-sm font-medium">
            <Link
              href="/#divisions"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <LayoutGrid className="w-4 h-4 text-brand-500" />
              <span>Catalog & Sizing</span>
            </Link>

            <Link
              href="/calculator"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Calculator className="w-4 h-4 text-brand-500" />
              <span>Instant Calculator</span>
            </Link>

            <Link
              href="/gallery"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Work Gallery
            </Link>

            {/* Role-specific Navigation */}
            {role === "customer" && (
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 text-foreground font-semibold px-3 py-1.5 rounded-md bg-secondary transition-colors"
              >
                <UserCheck className="w-4 h-4 text-brand-500" />
                <span>Customer Portal</span>
                <Badge variant="industrial" className="ml-1 text-[10px] px-1.5 py-0">
                  {user?.full_name?.split(" ")[0] || "Account"}
                </Badge>
              </Link>
            )}

            {role === "admin" && (
              <Link
                href="/production"
                className="flex items-center gap-1.5 text-white font-semibold px-3 py-1.5 rounded-md bg-industrial-950 hover:bg-industrial-900 transition-colors shadow-sm"
              >
                <Kanban className="w-4 h-4 text-brand-500" />
                <span>Production Console</span>
                <Badge variant="default" className="ml-1 text-[10px] px-1.5 py-0 bg-brand-500">
                  Staff
                </Badge>
              </Link>
            )}
          </nav>

          {/* Right Action Buttons */}
          <div className="hidden md:flex items-center gap-3">
            {role === "visitor" ? (
              <>
                <Button asChild variant="ghost" size="sm" className="font-semibold text-xs">
                  <Link href="/login">Sign In</Link>
                </Button>
                <Button asChild size="sm" className="font-semibold shadow-sm text-xs bg-brand-500 hover:bg-brand-600">
                  <Link href="/signup">Create Account</Link>
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="text-right font-mono hidden lg:block">
                  <div className="text-xs font-bold text-foreground">{user?.full_name || user?.email}</div>
                  <div className="text-[10px] text-brand-500 font-semibold uppercase">{role}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={signOut}
                  className="text-xs font-mono"
                >
                  Sign Out
                </Button>
              </div>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-md hover:bg-secondary text-foreground"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-3">
          <div className="flex flex-col gap-2 pt-1">
            <Link
              href="/#divisions"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2 text-sm py-2 font-medium"
            >
              <LayoutGrid className="w-4 h-4 text-brand-500" />
              Catalog & Sizing
            </Link>
            <Link
              href="/calculator"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2 text-sm py-2 font-medium"
            >
              <Calculator className="w-4 h-4 text-brand-500" />
              Instant Price Calculator
            </Link>
            <Link
              href="/gallery"
              onClick={() => setMobileMenuOpen(false)}
              className="text-sm py-2 font-medium text-muted-foreground"
            >
              Work Gallery
            </Link>

            <Separator className="my-1" />

            <Link
              href="/dashboard"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2 text-sm py-2 font-medium"
            >
              <UserCheck className="w-4 h-4 text-brand-500" />
              Customer Dashboard
            </Link>
            <Link
              href="/production"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2 text-sm py-2 font-medium"
            >
              <Kanban className="w-4 h-4 text-brand-500" />
              Production Pipeline (Admin)
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
