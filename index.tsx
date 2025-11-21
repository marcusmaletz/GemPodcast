import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Mic, Play, Pause, Download, Loader2, Volume2, Music, Upload, Square, 
  Search, Sparkles, Globe, Users, Mic2 
} from 'lucide-react';

// ----------------------------------------------------------------------
// TYPES
// ----------------------------------------------------------------------

export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr',
}

export interface ScriptLine {
  speaker: string;
  text: string;
}

export interface GeneratedScriptResponse {
  title: string;
  script: string;
  searchSources?: { title: string; uri: string }[];
}

export type BackgroundMusicPreset = 'none' | 'chill' | 'news';

// ----------------------------------------------------------------------
// UTILS
// ----------------------------------------------------------------------

const decodeBase64Audio = async (
  base64String: string,
  ctx: AudioContext
): Promise<AudioBuffer> => {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const dataInt16 = new Int16Array(bytes.buffer);
  const numChannels = 1;
  const sampleRate = 24000; 
  const frameCount = dataInt16.length / numChannels;
  
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  const channelData = buffer.getChannelData(0);
  
  for (let i = 0; i < frameCount; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  
  return buffer;
};

const mixAudioBuffers = (
  voiceBuffer: AudioBuffer,
  musicBuffer: AudioBuffer | null,
  musicVolume: number,
  ctx: AudioContext
): AudioBuffer => {
  if (!musicBuffer) return voiceBuffer;

  const outputLength = voiceBuffer.length;
  const outputChannels = Math.max(voiceBuffer.numberOfChannels, musicBuffer.numberOfChannels);
  const mixed = ctx.createBuffer(outputChannels, outputLength, voiceBuffer.sampleRate);

  for (let c = 0; c < outputChannels; c++) {
    const voiceChannelIndex = c % voiceBuffer.numberOfChannels;
    const voiceData = voiceBuffer.getChannelData(voiceChannelIndex);
    
    const musicChannelIndex = c % musicBuffer.numberOfChannels;
    const musicData = musicBuffer.getChannelData(musicChannelIndex);
    
    const outData = mixed.getChannelData(c);

    for (let i = 0; i < outputLength; i++) {
      const voiceSample = voiceData[i];
      const musicSample = musicData[i % musicBuffer.length];
      
      let mixedSample = voiceSample + (musicSample * musicVolume);
      
      const remaining = outputLength - i;
      const fadeLength = 2 * mixed.sampleRate;
      if (remaining < fadeLength) {
        const fade = remaining / fadeLength;
        mixedSample = voiceSample + (musicSample * musicVolume * fade);
      }

      if (mixedSample > 1) mixedSample = 1;
      if (mixedSample < -1) mixedSample = -1;
      
      outData[i] = mixedSample;
    }
  }
  return mixed;
};

const generateProceduralTrack = (
  type: 'chill' | 'news',
  duration: number,
  ctx: AudioContext
): AudioBuffer => {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sampleL = 0;
    let sampleR = 0;

    if (type === 'chill') {
      const f1 = Math.sin(t * 220 * Math.PI * 2);
      const f2 = Math.sin(t * 277 * Math.PI * 2);
      const f3 = Math.sin(t * 329 * Math.PI * 2);
      const mod = Math.sin(t * 0.5 * Math.PI * 2) * 0.5 + 0.5;
      sampleL = (f1 + f2) * 0.1 * mod;
      sampleR = (f2 + f3) * 0.1 * (1 - mod);
      const noise = (Math.random() * 2 - 1) * 0.02;
      sampleL += noise;
      sampleR += noise;
    } else if (type === 'news') {
      const beat = t % 0.5; 
      let pulse = 0;
      if (beat < 0.05) pulse = (Math.random() * 2 - 1) * 0.1;
      const drone = Math.sin(t * 146 * Math.PI * 2) * 0.05;
      sampleL = pulse + drone;
      sampleR = pulse * 0.8 + drone;
    }

    left[i] = sampleL;
    right[i] = sampleR;
  }

  return buffer;
};

const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }
  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); 
  setUint16(numOfChan * 2); 
  setUint16(16); 
  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); 

  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos])); 
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }
  return new Blob([bufferArr], { type: "audio/wav" });
};

const audioBufferToMp3 = (buffer: AudioBuffer): Blob => {
  // @ts-ignore
  const lamejs = window.lamejs;
  if (!lamejs) {
    throw new Error("Lamejs library not found");
  }

  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const kbps = 320; 
  
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: Int8Array[] = [];

  const rawLeft = buffer.getChannelData(0);
  const rawRight = channels > 1 ? buffer.getChannelData(1) : rawLeft;
  const length = rawLeft.length;
  
  const sampleBlockSize = 1152; 
  const leftInt16 = new Int16Array(sampleBlockSize);
  const rightInt16 = new Int16Array(sampleBlockSize);
  
  for (let i = 0; i < length; i += sampleBlockSize) {
    const chunkLen = Math.min(sampleBlockSize, length - i);
    for (let j = 0; j < chunkLen; j++) {
      const l = Math.max(-1, Math.min(1, rawLeft[i + j]));
      const r = Math.max(-1, Math.min(1, rawRight[i + j]));
      leftInt16[j] = (l < 0 ? l * 32768 : l * 32767);
      rightInt16[j] = (r < 0 ? r * 32768 : r * 32767);
    }

    const leftChunk = (chunkLen === sampleBlockSize) ? leftInt16 : leftInt16.subarray(0, chunkLen);
    const rightChunk = (chunkLen === sampleBlockSize) ? rightInt16 : rightInt16.subarray(0, chunkLen);
    
    let mp3buf;
    if (channels === 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    }
    
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) mp3Data.push(mp3buf);

  return new Blob(mp3Data, { type: 'audio/mp3' });
};

// ----------------------------------------------------------------------
// SERVICE
// ----------------------------------------------------------------------

const getApiKey = () => {
  try {
    // @ts-ignore
    return process.env.API_KEY || '';
  } catch (e) {
    console.warn("API Key access error", e);
    return '';
  }
}

const ai = new GoogleGenAI({ apiKey: getApiKey() });

const generateScript = async (
  topic: string,
  hostName: string,
  guestName: string,
  useSearch: boolean = false
): Promise<GeneratedScriptResponse> => {
  try {
    const modelId = "gemini-2.5-flash";
    
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

    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: config
    });

    const text = response.text || "";
    
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

const generateVoicePreview = async (
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
    if (!parts || parts.length === 0) throw new Error("No audio content generated.");
    const inlineData = parts[0].inlineData;
    if (!inlineData || !inlineData.data) throw new Error("No inline audio data found.");

    return inlineData.data; 
  } catch (error) {
    console.error("Error generating voice preview:", error);
    throw error;
  }
};

const generatePodcastAudio = async (
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
    if (!parts || parts.length === 0) throw new Error("No audio content generated.");
    const inlineData = parts[0].inlineData;
    if (!inlineData || !inlineData.data) throw new Error("No inline audio data found.");

    return inlineData.data;
  } catch (error) {
    console.error("Error generating audio:", error);
    throw error;
  }
};

// ----------------------------------------------------------------------
// COMPONENTS
// ----------------------------------------------------------------------

// --- ScriptSection ---
interface ScriptSectionProps {
  onScriptReady: (script: string, hostName: string, guestName: string) => void;
}

const ScriptSection: React.FC<ScriptSectionProps> = ({ onScriptReady }) => {
  const [topic, setTopic] = useState('');
  const [hostName, setHostName] = useState('Host');
  const [guestName, setGuestName] = useState('Guest');
  const [loading, setLoading] = useState(false);
  const [useSearch, setUseSearch] = useState(false);
  const [currentScript, setCurrentScript] = useState('');
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);

  const handleGenerate = async () => {
    if (!topic.trim() || !hostName.trim() || !guestName.trim()) return;
    setLoading(true);
    setSources([]);
    try {
      const result: GeneratedScriptResponse = await generateScript(topic, hostName, guestName, useSearch);
      setCurrentScript(result.script);
      if (result.searchSources) {
        setSources(result.searchSources);
      }
      onScriptReady(result.script, hostName, guestName);
    } catch (error) {
      alert("Failed to generate script. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setCurrentScript(newVal);
    onScriptReady(newVal, hostName, guestName);
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg mb-8">
      <div className="p-6 border-b border-slate-700 bg-slate-900/50">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          Step 1: Generate Script
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Enter a topic and define your speakers.
        </p>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" /> Speaker 1 Name
            </label>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="e.g., Sarah"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
           </div>
           <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
               <Users className="w-4 h-4 text-slate-400" /> Speaker 2 Name
            </label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="e.g., Tom"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
           </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Podcast Topic
            </label>
            <div className="relative">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., The latest breakthroughs in quantum computing"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center cursor-pointer gap-3 text-slate-300 hover:text-white transition-colors">
              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useSearch ? 'bg-purple-600 border-purple-600' : 'border-slate-600'}`}>
                {useSearch && <Globe className="w-3 h-3 text-white" />}
              </div>
              <input 
                type="checkbox" 
                className="hidden" 
                checked={useSearch} 
                onChange={(e) => setUseSearch(e.target.checked)} 
              />
              <span className="text-sm font-medium">Use Google Search Grounding (Real-time info)</span>
            </label>

            <button
              onClick={handleGenerate}
              disabled={loading || !topic.trim() || !hostName.trim() || !guestName.trim()}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-white transition-all transform active:scale-95
                ${loading || !topic.trim() 
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                  : 'bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-900/20'
                }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Writing...
                </>
              ) : (
                <>
                  Generate Script
                </>
              )}
            </button>
          </div>
        </div>

        {currentScript && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-300">
                Script Editor
              </label>
              <span className="text-xs text-slate-500">Editable</span>
            </div>
            <textarea
              value={currentScript}
              onChange={handleScriptChange}
              rows={10}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 leading-relaxed"
            />
            {sources.length > 0 && (
              <div className="mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Sources Used</h4>
                <ul className="space-y-2">
                  {sources.map((source, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs">
                      <Globe className="w-3 h-3 text-purple-400 mt-0.5 shrink-0" />
                      <a 
                        href={source.uri} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-purple-300 hover:text-purple-200 hover:underline truncate"
                      >
                        {source.title || source.uri}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- AudioSection ---
interface AudioSectionProps {
  script: string;
  hostName: string;
  guestName: string;
}

const AudioSection: React.FC<AudioSectionProps> = ({ script, hostName, guestName }) => {
  const [hostVoice, setHostVoice] = useState<VoiceName>(VoiceName.Kore);
  const [guestVoice, setGuestVoice] = useState<VoiceName>(VoiceName.Puck);
  const [musicPreset, setMusicPreset] = useState<BackgroundMusicPreset>('none');
  const [customMusicFile, setCustomMusicFile] = useState<File | null>(null);
  const [musicVolume, setMusicVolume] = useState<number>(0.15);
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  const stopPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setPlayingPreview(null);
  };

  const playPreviewAudio = (blob: Blob, id: string) => {
    stopPreview();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => {
      setPlayingPreview(null);
      URL.revokeObjectURL(url);
    };
    previewAudioRef.current = audio;
    audio.play();
    setPlayingPreview(id);
  };

  const handleVoicePreview = async (voice: VoiceName, id: 'host' | 'guest') => {
    if (playingPreview === id) {
      stopPreview();
      return;
    }
    setPreviewLoading(id);
    try {
      const name = id === 'host' ? hostName : guestName;
      const text = `Hallo, ich bin ${voice}. Ich werde heute die Stimme von ${name} sein.`;
      const base64 = await generateVoicePreview(voice, text);
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = await decodeBase64Audio(base64, ctx);
      const blob = audioBufferToWav(buffer);
      await ctx.close();
      playPreviewAudio(blob, id);
    } catch (err) {
      console.error(err);
      alert("Failed to preview voice");
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleMusicPreview = async (preset: BackgroundMusicPreset | 'custom') => {
    const id = `music-${preset}`;
    if (playingPreview === id) {
      stopPreview();
      return;
    }
    setPreviewLoading(id);
    try {
      let blob: Blob | null = null;
      if (preset === 'custom') {
        if (!customMusicFile) return;
        blob = customMusicFile;
      } else if (preset !== 'none') {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const buffer = generateProceduralTrack(preset as any, 5, ctx);
        blob = audioBufferToWav(buffer);
        await ctx.close();
      }
      if (blob) {
        playPreviewAudio(blob, id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleGenerateAudio = async () => {
    if (!script.trim()) return;
    stopPreview();
    setLoading(true);
    setError(null);
    setAudioUrl(null);

    try {
      const base64Data = await generatePodcastAudio(script, hostName, guestName, hostVoice, guestVoice);
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ttsBufferRaw = await decodeBase64Audio(base64Data, audioContext);
      
      let musicBuffer: AudioBuffer | null = null;

      if (musicPreset !== 'none') {
        if (musicPreset === 'chill' || musicPreset === 'news') {
           const duration = ttsBufferRaw.duration;
           const tempCtx = new OfflineAudioContext(2, Math.ceil(duration * 24000), 24000);
           musicBuffer = generateProceduralTrack(musicPreset, duration, tempCtx as unknown as AudioContext);
        } 
      } else if (customMusicFile) {
        const fileBuffer = await customMusicFile.arrayBuffer();
        const offlineCtx = new OfflineAudioContext(2, 1, 24000); 
        musicBuffer = await offlineCtx.decodeAudioData(fileBuffer);
      }

      const mixedBuffer = mixAudioBuffers(ttsBufferRaw, musicBuffer, musicVolume, audioContext);
      const mp3Blob = audioBufferToMp3(mixedBuffer);
      
      const url = URL.createObjectURL(mp3Blob);
      setAudioUrl(url);
      await audioContext.close();
    } catch (err) {
      console.error(err);
      setError("Failed to generate audio. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setCustomMusicFile(e.target.files[0]);
      setMusicPreset('none');
    }
  };

  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg transition-opacity duration-500 ${!script ? 'opacity-50 pointer-events-none blur-[1px]' : 'opacity-100'}`}>
      <div className="p-6 border-b border-slate-700 bg-slate-900/50">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-purple-400" />
          Step 2: Create Audio
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Assign voices and add background atmosphere.
        </p>
      </div>

      <div className="p-6 space-y-8">
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Mic className="w-4 h-4" /> Cast
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">{hostName} (Voice)</label>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <select
                            value={hostVoice}
                            onChange={(e) => setHostVoice(e.target.value as VoiceName)}
                            className="w-full appearance-none bg-slate-900 border border-slate-700 text-white rounded-lg py-3 px-4 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                            >
                            {Object.values(VoiceName).map((v) => (
                                <option key={v} value={v}>{v}</option>
                            ))}
                            </select>
                        </div>
                        <button
                            onClick={() => handleVoicePreview(hostVoice, 'host')}
                            disabled={previewLoading !== null && previewLoading !== 'host'}
                            className="px-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors flex items-center justify-center min-w-[48px]"
                        >
                            {previewLoading === 'host' ? (
                                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                            ) : playingPreview === 'host' ? (
                                <Square className="w-4 h-4 fill-current" />
                            ) : (
                                <Play className="w-4 h-4 fill-current" />
                            )}
                        </button>
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">{guestName} (Voice)</label>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <select
                            value={guestVoice}
                            onChange={(e) => setGuestVoice(e.target.value as VoiceName)}
                            className="w-full appearance-none bg-slate-900 border border-slate-700 text-white rounded-lg py-3 px-4 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                            >
                            {Object.values(VoiceName).map((v) => (
                                <option key={v} value={v}>{v}</option>
                            ))}
                            </select>
                        </div>
                        <button
                            onClick={() => handleVoicePreview(guestVoice, 'guest')}
                            disabled={previewLoading !== null && previewLoading !== 'guest'}
                            className="px-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors flex items-center justify-center min-w-[48px]"
                        >
                             {previewLoading === 'guest' ? (
                                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                            ) : playingPreview === 'guest' ? (
                                <Square className="w-4 h-4 fill-current" />
                            ) : (
                                <Play className="w-4 h-4 fill-current" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div className="h-px bg-slate-700/50" />

        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Music className="w-4 h-4" /> Background Music
                </h3>
                {(musicPreset !== 'none' || customMusicFile) && (
                     <div className="flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-slate-400" />
                        <input 
                            type="range" 
                            min="0" 
                            max="0.5" 
                            step="0.01" 
                            value={musicVolume}
                            onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                            className="w-24 h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                        <span className="text-xs text-slate-400 w-8">{Math.round(musicVolume * 100)}%</span>
                     </div>
                )}
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button 
                    onClick={() => { setMusicPreset('none'); setCustomMusicFile(null); stopPreview(); }}
                    className={`p-3 rounded-lg border text-left transition-all ${musicPreset === 'none' && !customMusicFile ? 'bg-purple-600/20 border-purple-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                >
                    <div className="text-sm font-medium">None</div>
                    <div className="text-xs opacity-70 mt-1">No background</div>
                </button>

                <div className={`relative p-1 rounded-lg border transition-all group ${musicPreset === 'chill' ? 'bg-purple-600/20 border-purple-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    <div 
                        onClick={() => { setMusicPreset('chill'); setCustomMusicFile(null); }}
                        className="p-2 cursor-pointer h-full"
                    >
                        <div className="text-sm font-medium">Relaxed</div>
                        <div className="text-xs opacity-70 mt-1">Gentle Ambience</div>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleMusicPreview('chill'); }}
                        className="absolute top-2 right-2 w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600 hover:text-white transition-colors"
                    >
                         {previewLoading === 'music-chill' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : playingPreview === 'music-chill' ? (
                            <Square className="w-3 h-3 fill-current" />
                        ) : (
                            <Play className="w-3 h-3 fill-current ml-0.5" />
                        )}
                    </button>
                </div>
                
                <div className={`relative p-1 rounded-lg border transition-all group ${musicPreset === 'news' ? 'bg-purple-600/20 border-purple-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    <div 
                        onClick={() => { setMusicPreset('news'); setCustomMusicFile(null); }}
                        className="p-2 cursor-pointer h-full"
                    >
                        <div className="text-sm font-medium">News Room</div>
                        <div className="text-xs opacity-70 mt-1">Subtle Pulse</div>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleMusicPreview('news'); }}
                        className="absolute top-2 right-2 w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600 hover:text-white transition-colors"
                    >
                        {previewLoading === 'music-news' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : playingPreview === 'music-news' ? (
                            <Square className="w-3 h-3 fill-current" />
                        ) : (
                            <Play className="w-3 h-3 fill-current ml-0.5" />
                        )}
                    </button>
                </div>

                <div className={`relative p-1 rounded-lg border transition-all overflow-hidden group ${customMusicFile ? 'bg-purple-600/20 border-purple-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    <input 
                        type="file" 
                        accept="audio/*" 
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                     <div className="p-2 h-full flex flex-col justify-center">
                        <div className="text-sm font-medium flex items-center gap-2">
                            <Upload className="w-3 h-3" />
                            {customMusicFile ? 'Custom' : 'Upload'}
                        </div>
                        <div className="text-xs opacity-70 mt-1 truncate pr-6">
                            {customMusicFile ? customMusicFile.name : 'Select Audio'}
                        </div>
                    </div>
                    {customMusicFile && (
                        <button
                             onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleMusicPreview('custom'); }}
                             className="absolute top-2 right-2 w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600 hover:text-white transition-colors z-20"
                        >
                             {playingPreview === 'music-custom' ? (
                                <Square className="w-3 h-3 fill-current" />
                            ) : (
                                <Play className="w-3 h-3 fill-current ml-0.5" />
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>

        <div className="flex justify-end pt-4">
          <button
            onClick={handleGenerateAudio}
            disabled={loading || !script}
            className={`flex items-center gap-2 px-8 py-4 rounded-lg font-bold text-white transition-all transform active:scale-[0.99]
              ${loading 
                ? 'bg-slate-700 cursor-wait' 
                : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-xl shadow-purple-900/30 hover:shadow-purple-900/50'
              }`}
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>
                    {musicPreset !== 'none' || customMusicFile ? 'Mixing Audio...' : 'Synthesizing...'}
                </span>
              </>
            ) : (
              <>
                <Music className="w-5 h-5" />
                Generate Podcast
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center animate-fade-in">
            {error}
          </div>
        )}

        {audioUrl && (
          <div className="animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="bg-slate-900 rounded-xl p-6 border border-slate-700 shadow-inner">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-600/20 flex items-center justify-center text-purple-400">
                    <Music className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">Final Podcast</h3>
                    <p className="text-xs text-slate-500">
                        {musicPreset !== 'none' || customMusicFile ? 'Voice + Music Mixed' : 'Voice Only'} • 320kbps MP3
                    </p>
                  </div>
                </div>
                <a
                  href={audioUrl}
                  download="gemini-podcast.mp3"
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  title="Download MP3"
                >
                  <Download className="w-5 h-5" />
                </a>
              </div>
              
              <audio 
                ref={audioRef} 
                src={audioUrl} 
                controls 
                className="w-full h-10 accent-purple-500" 
                style={{ borderRadius: '8px' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// MAIN APP
// ----------------------------------------------------------------------

const App: React.FC = () => {
  const [script, setScript] = useState('');
  const [hostName, setHostName] = useState('Host');
  const [guestName, setGuestName] = useState('Guest');

  const handleScriptReady = (newScript: string, newHost: string, newGuest: string) => {
    setScript(newScript);
    setHostName(newHost);
    setGuestName(newGuest);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 selection:bg-purple-500/30">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-indigo-900/20 rounded-full blur-[128px]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-12">
        <header className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-900/50 mb-4">
            <Mic2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 tracking-tight">
            Gemini Podcast Studio
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Generate a podcast script and convert it to a multi-speaker audio experience using only Gemini.
          </p>
        </header>

        <main className="space-y-8">
          <ScriptSection onScriptReady={handleScriptReady} />
          <AudioSection 
            script={script} 
            hostName={hostName}
            guestName={guestName}
          />
        </main>

        <footer className="mt-20 text-center text-slate-600 text-sm border-t border-slate-800 pt-8">
          <p>Powered by Gemini 2.5 Flash & Flash-TTS</p>
        </footer>
      </div>
    </div>
  );
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);