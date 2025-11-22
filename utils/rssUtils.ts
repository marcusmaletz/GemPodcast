
import { RssArticle } from '../types.ts';

/**
 * Fetches and parses RSS feeds using a CORS proxy to avoid browser restrictions.
 */

// We use allorigins.win as a public CORS proxy. 
const CORS_PROXY = "https://api.allorigins.win/get?url=";

export const fetchRssFeeds = async (urls: string[]): Promise<{ combinedContent: string, articles: RssArticle[] }> => {
  if (urls.length === 0) return { combinedContent: "", articles: [] };

  let combinedContent = "RSS FEED SUMMARY (Use these details for deep analysis):\n";
  const allArticles: RssArticle[] = [];
  
  const validUrls = urls.filter(u => u.trim().length > 0);

  for (const url of validUrls) {
    try {
      const encodedUrl = encodeURIComponent(url.trim());
      const response = await fetch(`${CORS_PROXY}${encodedUrl}`);
      const data = await response.json();
      
      if (!data.contents) continue;

      // Parse XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(data.contents, "text/xml");

      const channelTitle = xmlDoc.querySelector("channel > title")?.textContent || xmlDoc.querySelector("feed > title")?.textContent || "Unknown Feed";
      
      // Support both RSS (item) and Atom (entry)
      const items = Array.from(xmlDoc.querySelectorAll("item, entry"));

      // Limit to top 5 items per feed to keep context manageable but rich
      const topItems = items.slice(0, 5);

      combinedContent += `\n--- SOURCE FEED: ${channelTitle} ---\n`;

      topItems.forEach(item => {
        const title = item.querySelector("title")?.textContent?.trim() || "No Title";
        
        // Extract content:encoded if available (richer content), otherwise description or summary
        const contentEncoded = item.getElementsByTagName("content:encoded")[0]?.textContent;
        const description = item.querySelector("description")?.textContent;
        const summary = item.querySelector("summary")?.textContent; // Atom
        
        let fullText = contentEncoded || description || summary || "";
        // Strip HTML tags
        fullText = fullText.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
        
        // Robust link extraction (RSS vs Atom)
        let link = "";
        const linkNode = item.querySelector("link");
        if (linkNode) {
            // Check for Atom-style href attribute first, then text content
            link = linkNode.getAttribute("href") || linkNode.textContent?.trim() || "";
        }
        // Fallback: check guid/id if it looks like a URL
        if (!link) {
            const idNode = item.querySelector("guid, id");
            const idText = idNode?.textContent?.trim();
            if (idText && (idText.startsWith("http") || idText.startsWith("https"))) {
                link = idText;
            }
        }

        const articleObj: RssArticle = {
          title,
          description: fullText.substring(0, 200), // Short desc for UI
          link,
          source: channelTitle
        };
        allArticles.push(articleObj);
        
        combinedContent += `\n- HEADLINE: ${title}\n`;
        if (fullText) {
           // Pass up to 1500 chars for Gemini to analyze (Deep Dive)
           const analysisText = fullText.length > 1500 ? fullText.substring(0, 1500) + "..." : fullText;
           combinedContent += `  DETAILS: ${analysisText}\n`;
        }
      });

    } catch (error) {
      console.error(`Failed to fetch RSS feed: ${url}`, error);
      combinedContent += `\n(Failed to load feed: ${url})\n`;
    }
  }

  return { combinedContent, articles: allArticles };
};
