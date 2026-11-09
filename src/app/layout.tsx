import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { signOutAction } from "./actions";

export const metadata: Metadata = { title: "Realty Vault — Bookings", description: "SCD entry, approvals and Bkg" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const links: [string, string, boolean][] = user
    ? [
        ["/", "Home", true],
        ["/scd/new", "New SCD", true],
        ["/submissions", "SCDs & approvals", true],
        ["/bookings", "Bookings (SCD lookup)", true],
        ["/bulk", "Bulk upload", user.role === "master"],
        ["/admin/users", "Users", user.role === "master"],
      ]
    : [];
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--line)] bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold text-[var(--brand)]">Realty Vault</Link>
            <nav className="flex flex-wrap gap-4 text-sm">
              {links.filter((l) => l[2]).map(([href, label]) => (
                <Link key={href} href={href} className="text-slate-700 hover:text-[var(--brand)]">{label}</Link>
              ))}
            </nav>
            {user && (
              <form action={signOutAction} className="ml-auto flex items-center gap-3 text-sm">
                <span className="text-[var(--muted)]">{user.name} · <span className="capitalize">{user.role}</span></span>
                <button className="btn">Sign out</button>
              </form>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
