import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// The page and the promotion's terms: the demo blueprints beside it are framed in, and keep themselves out of search (app/app/layout.tsx).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://blpr.dev/", changeFrequency: "weekly", priority: 1 },
    { url: "https://blpr.dev/promotion", changeFrequency: "weekly", priority: 0.5 },
  ];
}
