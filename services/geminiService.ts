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
  useSearch: boolean = false
): Promise<GeneratedScriptResponse> => {
  try {
    const modelId = useSearch ? "gemini-2.5-flash" : "gemini-2.5-flash";
    
    const prompt = `
      You are a professional podcast producer. Write a short, engaging podcast script between two people: "${hostName}" and "${guestName}".
      The topic is: "${topic}".
      
      Format constraints:
      1. The script must be a dialogue.
      2. Use "${hostName}:" and "${guestName}:" as prefixes for each line.
      3. Keep it between 150-300 words total.
      4. Make it sound natural, conversational, and enthusiastic.
      5. Do not include sound effects or stage directions like [laughs].
      6. Start immediately with the dialogue.
    `;

    const config: any = {
      temperature: 0.7,
    };

    // Add tools if search is requested
    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
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

    return {
      title: `Podcast: ${topic}`,
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