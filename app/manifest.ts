import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WorkCraft AI",
    short_name: "WorkCraft AI",
    description: "Estimates, customers, jobs, and invoices for independent contractors.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f4ed",
    theme_color: "#1c2b25",
    icons: [
      { src: "/icons/workcraft-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/workcraft-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/workcraft-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
