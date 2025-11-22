
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { GeneratedScriptResponse, VoiceName } from "../types.ts";

// Ensure API Key is present
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("API_KEY is missing from environment variables.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY || '' });

/**
 * Generates a podcast script based on a topic.
 * Uses Google Search grounding if requested.
 */
export const generateScript = async (
  topic: string,
  hostName: string,
  guestName: string,
  useSearch: boolean = false,
  rssContent: string = "",
  customSystemInstruction?: string
): Promise<GeneratedScriptResponse> => {
  try {
    const modelId = useSearch ? "gemini-2.5-flash" : "gemini-2.5-flash";
    
    // Default instruction if none provided
    const defaultSystemInstruction = `Du bist ein professioneller, investigativer Podcast-Produzent.
Deine Aufgabe ist es, einen tiefgründigen, spannenden Podcast-Dialog basierend auf dem Thema und den bereitgestellten Quellen zu schreiben.

WICHTIGE REGELN FÜR DEN INHALT:
1. **SPRACHE**: Der gesamte Dialog muss zwingend auf DEUTSCH verfasst sein.
2. **KEIN OBERFLÄCHLICHER SMALLTALK**: Analysiere die AUSWIRKUNGEN und HINTERGRÜNDE.
3. **DISKUSSION**: Der Host und der Gast sollten leicht unterschiedliche Perspektiven haben oder kritische Nachfragen stellen.
4. **NATÜRLICHKEIT**: Es soll wie ein echtes Gespräch klingen, nicht wie vorgelesen.

Formatierung:
1. Das Skript muss ein Dialog sein.
2. Nutze exakt die vorgegebenen Sprechernamen als Präfix (z.B. "${hostName}:", "${guestName}:").
3. Länge: ca. 400-600 Wörter.
4. Starte sofort mit dem Dialog.`;

    const systemInstruction = customSystemInstruction || defaultSystemInstruction;

    let userPrompt = `Thema: "${topic}"\nSprecher 1 (Host): "${hostName}"\nSprecher 2 (Gast): "${guestName}"\n`;

    if (rssContent) {
        // STRICT MODE FOR RSS WITH CURATION
        userPrompt += `\n==================================================\n`;
        userPrompt += `ACHTUNG: RSS-MODUS AKTIV. NUTZE NUR DIE FOLGENDEN QUELLEN:\n`;
        userPrompt += `==================================================\n`;
        userPrompt += `${rssContent}\n`;
        userPrompt += `==================================================\n`;
        
        userPrompt += `\nSCHRITT 1: REDAKTIONELLE PRÜFUNG & KURATIERUNG (Bevor du schreibst):\n`;
        userPrompt += `1. **DEDUPLIZIERUNG**: Prüfe die Liste oben auf thematische Dopplungen. Wenn z.B. 'Heise' und 'Golem' über das gleiche Event berichten, fasse diese Informationen zu EINEM Thema zusammen. Besprich das Thema nicht zweimal!\n`;
        userPrompt += `2. **RELEVANZ-FILTER**: Filtere gnadenlos. Ignoriere:\n`;
        userPrompt += `   - Kleine Bugfixes oder Patch-Notes\n`;
        userPrompt += `   - Reine Produktwerbung oder Deals\n`;
        userPrompt += `   - Clickbait ohne echten Inhalt\n`;
        userPrompt += `   - Themen, die nichts mit dem Hauptthema "${topic}" zu tun haben\n`;
        userPrompt += `3. **PRIORISIERUNG**: Wähle aus den verbleibenden Themen nur die Top 3-4 wichtigsten "High Impact"-Themen aus (Durchbrüche, gesellschaftliche Relevanz, große Marktveränderungen).\n`;
        
        userPrompt += `\nSCHRITT 2: SCHREIBEN (STRIKTE ANWEISUNGEN):\n`;
        userPrompt += `1. Nutze AUSSCHLIESSLICH die Informationen aus den kuratierten RSS-Inhalten. Erfinde NICHTS dazu. Nutze KEIN externes Trainingswissen.\n`;
        userPrompt += `2. ZITIERPFLICHT: Du MUSST die Quelle verbal nennen, wenn du eine Information daraus nutzt.\n`;
        userPrompt += `   - Beispiel: "Laut einem Bericht von [QUELLE]..."\n`;
        userPrompt += `   - Wenn du Quellen zusammengefasst hast: "Wie sowohl [QUELLE A] als auch [QUELLE B] berichten..."\n`;
        userPrompt += `3. Wenn eine Information nicht in den Quellen oben steht, erwähne sie nicht.\n`;
    }

    // Add strict language constraint at the end of user prompt to override any potential drift
    userPrompt += `\n\nGeneriere jetzt das Skript basierend auf deiner redaktionellen Auswahl. WICHTIG: Schreibe den Dialog komplett auf DEUTSCH. Halte dich strikt an die Quellen.`;

    const config: any = {
      temperature: 0.3, // Lower temperature for more factual accuracy
      systemInstruction: systemInstruction,
    };

    // Add tools if search is requested (Note: Search and RSS usually shouldn't mix if we want strict RSS only, but we allow search if explicitly checked)
    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: userPrompt,
      config: config
    });

    const text = response.text || "";
    
    // Extract search sources if available
    let searchSources: { title: string; uri: string }[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      chunks.forEach((chunk: any) => {
        if (chunk.web) {
          searchSources.push({ title: chunk.web.title, uri: chunk.web.uri });
        }
      });
    }

    // Generate formatted Title: "AI-Podcast: [Topic] - [Date]"
    const dateStr = new Date().toLocaleDateString('de-DE');
    const shortTopic = topic.length > 30 ? topic.substring(0, 27) + "..." : topic;
    const formattedTitle = `AI-Podcast: ${shortTopic} - ${dateStr}`;

    return {
      title: formattedTitle,
      script: text,
      searchSources
    };

  } catch (error) {
    console.error("Error generating script:", error);
    throw error;
  }
};

/**
 * Generates a short preview for a single voice.
 */
export const generateVoicePreview = async (
  voice: VoiceName,
  text: string
): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice }
          }
        }
      }
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error("No audio content generated.");
    }

    const inlineData = parts[0].inlineData;
    if (!inlineData || !inlineData.data) {
      throw new Error("No inline audio data found.");
    }

    return inlineData.data; // Base64 string
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error generating voice preview:", error);
    
    if (errorMessage.includes("SAFETY")) {
        throw new Error("Preview blocked by safety filters. Please try a simpler text.");
    }
    throw error;
  }
};

/**
 * Generates audio from a script using Gemini Multi-speaker TTS.
 */
export const generatePodcastAudio = async (
  script: string,
  hostName: string,
  guestName: string,
  hostVoice: VoiceName,
  guestVoice: VoiceName
): Promise<string> => {
  try {
    // 1. Clean script - remove markdown bold/italic which can confuse TTS
    // Remove **word** or *word*
    const cleanedScript = script.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: cleanedScript }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: hostName,
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: hostVoice }
                }
              },
              {
                speaker: guestName,
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: guestVoice }
                }
              }
            ]
          }
        },
        // Explicitly allow looser safety settings for news content
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
        ]
      }
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
        // Check for finish reason if available
        const finishReason = response.candidates?.[0]?.finishReason;
        console.error("Finish Reason:", finishReason);
        throw new Error(`No audio content generated. Finish Reason: ${finishReason}`);
    }

    const inlineData = parts[0].inlineData;
    if (!inlineData || !inlineData.data) {
      throw new Error("No inline audio data found in response.");
    }

    return inlineData.data; // Base64 string

  } catch (error) {
    console.error("Error generating audio:", error);
    throw error;
  }
};
