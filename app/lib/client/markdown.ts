import type Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export const PLUGINS = [remarkGfm];
// HTML written into the Markdown (a centred logo, a badge row) is drawn, not
// printed, and cleaned the way GitHub cleans it: no script, no styles, no
// event handlers, only the tags and attributes a README may use.
export const REHYPE = [rehypeRaw, [rehypeSanitize, defaultSchema]] as NonNullable<React.ComponentProps<typeof Markdown>["rehypePlugins"]>;
