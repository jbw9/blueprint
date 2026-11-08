import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// One page: the demo blueprints beside it are framed in, and keep themselves out of search (app/app/layout.tsx).
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://blpr.dev/", changeFrequency: "weekly", priority: 1 }];
}
