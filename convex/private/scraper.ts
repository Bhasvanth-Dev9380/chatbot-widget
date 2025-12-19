import { action } from "../_generated/server";
import { v } from "convex/values";

export const scrapeUrl = action({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args): Promise<{ content: string; title: string }> => {
    try {
      const response = await fetch(args.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; EchoBot/1.0; +http://spinabot.com)",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1]?.trim() ?? "Untitled";

      // Remove script and style tags
      let cleanHtml = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");

      // Remove HTML tags but keep the text content
      const textContent = cleanHtml
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!textContent || textContent.length < 50) {
        throw new Error("No meaningful content found on the page");
      }

      return {
        content: textContent,
        title,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Scraping failed: ${error.message}`);
      }
      throw new Error("Scraping failed with unknown error");
    }
  },
});
