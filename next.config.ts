import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "exceljs"],
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};
export default nextConfig;
