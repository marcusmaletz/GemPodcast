
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
  customSystemInstruction?: string
): Promise<GeneratedScriptResponse> => {
  try {
    const modelId = useSearch ? "gemini-2.5-flash" : "gemini-2.5-flash";
    
    // Default instruction if none provided
    const defaultSystemInstruction = `You are a professional podcast producer.
Your task is to write a short, engaging podcast script based on the provided topic and speaker names.

Format constraints:
1. The script must be a dialogue.
2. Use the exact speaker names provided as prefixes for each line (e.g. "${hostName}:" and "${guestName}:").
3. Keep it between 150-300 words total.
4. Make it sound natural, conversational, and enthusiastic.
5. Do not include sound effects or stage directions like [laughs].
6. Start immediately with the dialogue.`;

    const systemInstruction = customSystemInstruction || defaultSystemInstruction;

    const userPrompt = `Topic: "${topic}"\nSpeaker 1 (Host): "${hostName}"\nSpeaker 2 (Guest): "${guestName}"\n\nPlease generate the script now.`;

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
    // We need to instruct the model explicitly to use the speakers defined in the config.
    // The prompt to the TTS model acts as the script.
    // We map the config 'speaker' names to match the script prefixes exactly.
    
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
