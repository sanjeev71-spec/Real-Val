import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { signOutAction } from "./actions";
import { COMPANY } from "../lib/company";
import { NavBar, type NavGroup, type NavItem } from "@/components/NavBar";
import { DensityToggle } from "@/components/DensityToggle";
import { NavProgress } from "@/components/NavProgress";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = { title: `${COMPANY.name} — Bookings`, description: `${COMPANY.form} entry, approvals and Bkg` };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const role = user?.role;
  const masterOrAdmin = role === "master" || role === "admin";
  const item = (href: string, label: string, show: boolean): NavItem[] => (show ? [{ href, label }] : []);

  const direct: NavItem[] = user ? [...item("/", "Home", true), ...item("/dashboard", "Dashboard", masterOrAdmin)] : [];
  const groups: NavGroup[] = user
    ? [
        { label: "Sales", items: [...item("/scd/new", `New ${COMPANY.form}`, role !== "hr"), ...item("/submissions", `${COMPANY.form} Approval`, role !== "hr"), ...item("/bookings", "Bkg", role !== "hr"), ...item("/bulk", "Upload Bkg", masterOrAdmin), ...item("/reports/demand", "Demand", role !== "hr")] },
        { label: "Accounts", items: [...item("/exp", "Exp", masterOrAdmin), ...item("/bulk/exp", "Upload Exp", masterOrAdmin), ...item("/bulk/all", "Bkg + Exp + Emp file", role === "master"), ...item("/changes", "Exp/Emp/Bkg approvals", role !== "sales"), ...item("/reports/pnl", "P&L", role === "master"), ...item("/reports/director-pack", "Director P&L packs", role === "master"), ...item("/reports/projection", "Projection", masterOrAdmin), ...item("/reports/exceptions", "Data exceptions", masterOrAdmin)] },
        { label: "People", items: [...item("/emp", "Emp", role === "hr" || role === "master"), ...item("/bulk/emp", "Upload Emp", role === "hr" || role === "master"), ...item("/reports/org", "Org chart", role !== "sales")] },
        { label: "Admin", items: [...item("/admin/masters", "Masters", role === "master"), ...item("/admin/masters/projects", "Projects", COMPANY.manualMasters && masterOrAdmin), ...item("/admin/masters/pricelist", "Price list", COMPANY.manualMasters && masterOrAdmin), ...item("/admin/masters/inventory", "Inventory", COMPANY.manualMasters && masterOrAdmin), ...item("/admin/projection", "Projection targets", role === "master"), ...item("/admin/users", "Users", role === "master"), ...item("/admin/cleanup", "Clean-up", role === "master")] },
      ].filter((g) => g.items.length)
    : [];
  return (
    <html lang="en" data-company={COMPANY.key} data-density="compact" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen`}>
        <NavProgress />
        <header className="sticky top-0 z-40 bg-[var(--header)] shadow-md">
          <div className="mx-auto flex max-w-[1760px] flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2.5">
            <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[12px] font-bold text-white">{COMPANY.name.slice(0, 1)}</span>
              {COMPANY.name}
            </Link>
            <NavBar direct={direct} groups={groups} />
            {user && (
              <form action={signOutAction} className="ml-auto flex items-center gap-3 text-[13px]">
                <DensityToggle />
                <span className="hidden text-white/70 sm:inline">{user.name} · <span className="capitalize">{user.role}</span></span>
                <button className="rounded-md border border-white/25 px-3 py-1 text-[13px] font-medium text-white transition hover:bg-white/10">Sign out</button>
              </form>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1760px] px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
