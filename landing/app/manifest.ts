import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Blueprint",
    short_name: "Blueprint",
    description: "Understand the code you didn't write.",
    start_url: "/",
    display: "browser",
    background_color: "#1a2fa0",
    theme_color: "#2438c8",
    icons: [{ src: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  };
}
