
import { GoogleGenAI, Modality } from "@google/genai";
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
2. **KEIN OBERFLÄCHLICHER SMALLTALK**: Liste nicht nur Schlagzeilen auf. Analysiere die AUSWIRKUNGEN und HINTERGRÜNDE der Nachrichten.
3. **QUELLEN NENNEN**: Wenn Fakten aus den RSS-Feeds besprochen werden, MUSS der Name der Quelle im Dialog genannt werden (z.B. "Laut Heise Online...", "Wie The Verge berichtet hat..."). Das ist Pflicht.
4. **DISKUSSION**: Der Host und der Gast sollten leicht unterschiedliche Perspektiven haben oder kritische Nachfragen stellen.
5. **NATÜRLICHKEIT**: Es soll wie ein echtes Gespräch klingen, nicht wie vorgelesen.

Formatierung:
1. Das Skript muss ein Dialog sein.
2. Nutze exakt die vorgegebenen Sprechernamen als Präfix (z.B. "${hostName}:", "${guestName}:").
3. Länge: ca. 300-500 Wörter.
4. Starte sofort mit dem Dialog.`;

    const systemInstruction = customSystemInstruction || defaultSystemInstruction;

    let userPrompt = `Thema: "${topic}"\nSprecher 1 (Host): "${hostName}"\nSprecher 2 (Gast): "${guestName}"\n`;

    if (rssContent) {
        userPrompt += `\n=== QUELLENMATERIAL (RSS FEEDS) ===\n${rssContent}\n\nANWEISUNG: Nutze die Details oben. Wähle die wichtigsten Stories aus. Nenne die Quellen verbal.`;
    }

    // Add strict language constraint at the end of user prompt to override any potential drift
    userPrompt += `\n\nGeneriere jetzt das Skript. WICHTIG: Schreibe den Dialog komplett auf DEUTSCH.`;

    const config: any = {
      temperature: 0.7,
      systemInstruction: systemInstruction,
    };

    // Add tools if search is requested
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
    console.error("Error generating voice preview:", error);
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
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: script }] }],
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
    console.error("Error generating audio:", error);
    throw error;
  }
};
