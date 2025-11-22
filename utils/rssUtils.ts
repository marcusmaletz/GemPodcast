
import { RssArticle } from '../types.ts';

/**
 * Fetches and parses RSS feeds using multiple CORS proxies to ensure reliability.
 * Fallback strategy: AllOrigins -> CorsProxy.io
 */

// Helper to fetch feed content using different strategies
const fetchFeedContent = async (url: string): Promise<string | null> => {
  const cleanUrl = url.trim();
  const encodedUrl = encodeURIComponent(cleanUrl);

  // Strategy 1: AllOrigins (Returns JSON with 'contents' field)
  // Good for text, handles encoding well.
  try {
    const response = await fetch(`https://api.allorigins.win/get?url=${encodedUrl}`);
    if (response.ok) {
      const data = await response.json();
      if (data.contents) return data.contents;
    }
  } catch (e) {
    console.warn(`AllOrigins proxy failed for ${cleanUrl}`, e);
  }

  // Strategy 2: CorsProxy.io (Returns raw response)
  // Often faster, good fallback.
  try {
    const response = await fetch(`https://corsproxy.io/?${encodedUrl}`);
    if (response.ok) {
      return await response.text();
    }
  } catch (e) {
    console.warn(`CorsProxy failed for ${cleanUrl}`, e);
  }

  return null;
};

export const fetchRssFeeds = async (urls: string[]): Promise<{ combinedContent: string, articles: RssArticle[] }> => {
  if (urls.length === 0) return { combinedContent: "", articles: [] };

  let combinedContent = "RSS FEED QUELLEMATERIAL (STRICT USE ONLY):\n";
  const allArticles: RssArticle[] = [];
  
  const validUrls = urls.filter(u => u.trim().length > 0);

  for (const url of validUrls) {
    try {
      // Fetch using fallback strategy
      const xmlString = await fetchFeedContent(url);

      if (!xmlString) {
        combinedContent += `\n(Fehler beim Laden des Feeds: ${url} - Zugriff verweigert oder Timeout bei allen Proxies)\n`;
        continue;
      }

      // Parse XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "text/xml");

      // Check for parsing errors
      const parseError = xmlDoc.querySelector("parsererror");
      if (parseError) {
        combinedContent += `\n(Fehler beim Lesen des XML-Formats für: ${url})\n`;
        continue;
      }

      // Extract Feed Title (Source Name)
      let channelTitle = "Unbekannte Quelle";
      const titleNode = xmlDoc.querySelector("channel > title") || xmlDoc.querySelector("feed > title");
      if (titleNode && titleNode.textContent) {
        channelTitle = titleNode.textContent.trim();
      }

      // Support both RSS (item) and Atom (entry)
      const items = Array.from(xmlDoc.querySelectorAll("item, entry"));

      // Limit to top 5 items per feed to keep context manageable but rich
      const topItems = items.slice(0, 5);

      combinedContent += `\n=== QUELLE: ${channelTitle} ===\n`;

      topItems.forEach(item => {
        // 1. Extract Title
        const title = item.querySelector("title")?.textContent?.trim() || "Ohne Titel";
        
        // 2. Extract Content (Prioritize full content, then description, then summary)
        // Namespaces can be tricky with querySelector, so we use getElementsByTagName for safety
        const contentEncoded = item.getElementsByTagName("content:encoded")[0]?.textContent;
        const description = item.querySelector("description")?.textContent;
        const summary = item.querySelector("summary")?.textContent; // Atom
        const content = item.querySelector("content")?.textContent;
        
        let fullText = contentEncoded || content || description || summary || "";
        
        // Strip HTML tags and clean up whitespace
        fullText = fullText.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
        
        // 3. Robust Link Extraction
        // Logic: Check Atom href -> Standard Link text -> GUID (if URL) -> ID (if URL)
        let link = "";
        
        // Method A: Atom style <link href="..." />
        const atomLinks = item.getElementsByTagName("link"); // generic tag name search
        if (atomLinks.length > 0) {
            for (let i = 0; i < atomLinks.length; i++) {
                const href = atomLinks[i].getAttribute("href");
                if (href) {
                    link = href;
                    break; // Found a valid href
                }
                // Method B: RSS style <link>http...</link>
                if (atomLinks[i].textContent && atomLinks[i].textContent?.startsWith('http')) {
                    link = atomLinks[i].textContent?.trim() || "";
                    break;
                }
            }
        }

        // Method C: Check specific node selectors if loop failed
        if (!link) {
             const directLink = item.querySelector("link")?.textContent?.trim();
             if (directLink && directLink.startsWith('http')) {
                 link = directLink;
             }
        }

        // Method D: Fallback to guid/id if it is a URL
        if (!link) {
            const idNode = item.querySelector("guid, id");
            const idText = idNode?.textContent?.trim();
            if (idText && (idText.startsWith("http") || idText.startsWith("https"))) {
                link = idText;
            }
        }

        // Method E: Regex search in raw HTML if standard parsing completely failed (Desperation move)
        if (!link) {
            const html = item.innerHTML;
            const urlMatch = html.match(/<link>(https?:\/\/[^<]+)<\/link>/i);
            if (urlMatch && urlMatch[1]) link = urlMatch[1];
        }

        const articleObj: RssArticle = {
          title,
          description: fullText.substring(0, 300), 
          link: link || "Link nicht gefunden",
          source: channelTitle
        };
        allArticles.push(articleObj);
        
        combinedContent += `\n- ARTIKEL: "${title}"\n`;
        // Pass Source Name explicitly for citation
        combinedContent += `  QUELLE: ${channelTitle}\n`;
        combinedContent += `  LINK: ${link}\n`; 
        if (fullText) {
           // Pass significant text for Deep Dive
           const analysisText = fullText.length > 2500 ? fullText.substring(0, 2500) + "..." : fullText;
           combinedContent += `  INHALT: ${analysisText}\n`;
        }
      });

    } catch (error) {
      console.error(`Failed to process RSS feed: ${url}`, error);
      combinedContent += `\n(Kritischer Fehler beim Verarbeiten des Feeds: ${url})\n`;
    }
  }

  return { combinedContent, articles: allArticles };
};
