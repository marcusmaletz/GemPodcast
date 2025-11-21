import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Mic2, Loader2, Search, Sparkles, Globe, Users, Settings, ChevronDown, ChevronUp, RotateCcw,
  Mic, Play, Pause, Download, Volume2, Music, Upload, Square, Trash2, Disc, Mail, X, Send, FileAudio, CheckCircle2, Save 
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

// --- TYPES ---

enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr',
}

interface ScriptLine {
  speaker: string;
  text: string;
}

interface GeneratedScriptResponse {
  title: string;
  script: string;
  searchSources?: { title: string; uri: string }[];
}

type MusicSlotIndex = -1 | 0 | 1 | 2;

interface StoredAudioFile {
  name: string;
  blob: Blob;
}

// --- AUDIO UTILS ---

/**
 * Decodes a base64 string into an AudioBuffer.
 */
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
  
  // Manual PCM decoding (Assumes 24kHz, Mono, 16-bit Little Endian based on typical Gemini output)
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

/**
 * Decodes a Blob (MP3/WAV) into an AudioBuffer.
 */
const decodeAudioBlob = async (
  blob: Blob,
  ctx: AudioContext
): Promise<AudioBuffer> => {
  const arrayBuffer = await blob.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
};

/**
 * Mixes a podcast sequence: Intro -> (Voice + Background) -> Outro.
 */
const mixPodcastSequence = async (
  voiceBuffer: AudioBuffer,
  backgroundBuffer: AudioBuffer | null,
  introBuffer: AudioBuffer | null,
  outroBuffer: AudioBuffer | null,
  musicVolume: number,
  introVolume: number,
  outroVolume: number
): Promise<AudioBuffer> => {
  const outputSampleRate = 44100; 
  const numberOfChannels = 2; // Stereo output

  const introDur = introBuffer ? introBuffer.duration : 0;
  const voiceDur = voiceBuffer.duration;
  const outroDur = outroBuffer ? outroBuffer.duration : 0;
  
  const totalDuration = introDur + voiceDur + outroDur;
  
  // @ts-ignore
  const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(numberOfChannels, Math.ceil(totalDuration * outputSampleRate), outputSampleRate);

  const createSource = (buffer: AudioBuffer, vol: number, startTime: number, stopTime?: number, loop: boolean = false) => {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = vol;

    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    source.start(startTime);
    if (stopTime !== undefined) {
      source.stop(stopTime);
    }
    return source;
  };

  if (introBuffer) {
    createSource(introBuffer, introVolume, 0);
  }

  createSource(voiceBuffer, 1.0, introDur);

  if (backgroundBuffer) {
    createSource(backgroundBuffer, musicVolume, introDur, introDur + voiceDur, true);
  }

  if (outroBuffer) {
    createSource(outroBuffer, outroVolume, introDur + voiceDur);
  }

  return await offlineCtx.startRendering();
};

/**
 * Converts an AudioBuffer to a WAV Blob.
 */
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

  const setUint16 = (data: number) => {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  const setUint32 = (data: number) => {
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
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

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

/**
 * Converts an AudioBuffer to a High Quality MP3 (320kbps) Blob.
 */
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
    
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};


// --- INDEXED DB ---

const DB_NAME = 'GeminiPodcastStudioDB';
const STORE_NAME = 'audioFiles';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error("IndexedDB Error:", request.error);
      reject(request.error);
    };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

const storeAudioFile = async (key: string, file: File): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const data = { name: file.name, blob: file };
    store.put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getAudioFile = async (key: string): Promise<{ name: string, blob: Blob } | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    return null;
  }
};

const deleteAudioFile = async (key: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// --- GEMINI SERVICE ---

const API_KEY = process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey: API_KEY || '' });

const generateScript = async (
  topic: string,
  hostName: string,
  guestName: string,
  useSearch: boolean = false,
  customSystemInstruction?: string
): Promise<GeneratedScriptResponse> => {
  try {
    const modelId = "gemini-2.5-flash";
    
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

    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: userPrompt,
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
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
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
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  } catch (error) {
    console.error("Error generating audio:", error);
    throw error;
  }
};

// --- COMPONENTS ---

const DEFAULT_SYSTEM_INSTRUCTION = `You are a professional podcast producer.
Your task is to write a short, engaging podcast script based on the provided topic and speaker names.

Format constraints:
1. The script must be a dialogue.
2. Use the exact speaker names provided as prefixes for each line.
3. Keep it between 150-300 words total.
4. Make it sound natural, conversational, and enthusiastic.
5. Do not include sound effects or stage directions like [laughs].
6. Start immediately with the dialogue.`;

const ScriptSection = ({ 
  onScriptReady, 
  hostName, 
  setHostName, 
  guestName, 
  setGuestName,
  topic,
  setTopic
}: any) => {
  const [loading, setLoading] = useState(false);
  const [useSearch, setUseSearch] = useState(() => localStorage.getItem('useSearch') === 'true');
  const [currentScript, setCurrentScript] = useState('');
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [systemInstruction, setSystemInstruction] = useState(() => localStorage.getItem('systemInstruction') || DEFAULT_SYSTEM_INSTRUCTION);

  useEffect(() => { localStorage.setItem('useSearch', useSearch.toString()); }, [useSearch]);
  useEffect(() => { localStorage.setItem('systemInstruction', systemInstruction); }, [systemInstruction]);

  const handleGenerate = async () => {
    if (!topic.trim() || !hostName.trim() || !guestName.trim()) return;
    setLoading(true);
    setSources([]);
    try {
      const result = await generateScript(topic, hostName, guestName, useSearch, systemInstruction);
      setCurrentScript(result.script);
      if (result.searchSources) setSources(result.searchSources);
      onScriptReady(result.script);
    } catch (error) {
      alert("Failed to generate script. Check API Key or quota.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetInstruction = () => setSystemInstruction(DEFAULT_SYSTEM_INSTRUCTION);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg mb-8">
      <div className="p-6 border-b border-slate-700 bg-slate-900/50">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          Step 1: Generate Script
        </h2>
        <p className="text-slate-400 text-sm mt-1">Enter a topic and define your speakers.</p>
      </div>
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-slate-400" /> Speaker 1 Name</label>
            <input type="text" value={hostName} onChange={(e) => setHostName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-4 text-white focus:ring-2 focus:ring-purple-500" />
           </div>
           <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2"><Users className="w-4 h-4 text-slate-400" /> Speaker 2 Name</label>
            <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-4 text-white focus:ring-2 focus:ring-purple-500" />
           </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Podcast Topic</label>
            <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 px-4 text-white focus:ring-2 focus:ring-purple-500" />
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="flex items-center cursor-pointer gap-3 text-slate-300 hover:text-white">
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useSearch ? 'bg-purple-600 border-purple-600' : 'border-slate-600'}`}>
                  {useSearch && <Globe className="w-3 h-3 text-white" />}
                </div>
                <input type="checkbox" className="hidden" checked={useSearch} onChange={(e) => setUseSearch(e.target.checked)} />
                <span className="text-sm font-medium">Use Google Search Grounding</span>
              </label>
              <button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white">
                <Settings className="w-3 h-3" /> {showSettings ? 'Hide Advanced' : 'Advanced Settings'} {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
            {showSettings && (
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">System Instruction</label>
                  <button onClick={handleResetInstruction} className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Reset</button>
                </div>
                <textarea value={systemInstruction} onChange={(e) => setSystemInstruction(e.target.value)} rows={6} className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-xs text-slate-300 font-mono" />
              </div>
            )}
            <button onClick={handleGenerate} disabled={loading || !topic.trim()} className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium text-white transition-all ${loading ? 'bg-slate-700' : 'bg-purple-600 hover:bg-purple-500'}`}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Generate Script
            </button>
          </div>
        </div>
        {currentScript && (
          <div className="animate-fade-in">
             <textarea value={currentScript} onChange={(e) => { setCurrentScript(e.target.value); onScriptReady(e.target.value); }} rows={10} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-300 font-mono text-sm leading-relaxed" />
             {sources.length > 0 && (
              <div className="mt-4 bg-slate-900/50 p-4 rounded-lg border border-slate-700/50">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Sources Used</h4>
                <ul className="space-y-2">{sources.map((s, i) => <li key={i}><a href={s.uri} target="_blank" className="text-purple-300 text-xs truncate block">{s.title}</a></li>)}</ul>
              </div>
             )}
          </div>
        )}
      </div>
    </div>
  );
};

const N8N_WEBHOOK_URL = 'https://anymal.app.n8n.cloud/webhook/send_mail';

const AudioSection = ({ script, hostName, guestName, topic }: any) => {
  const [hostVoice, setHostVoice] = useState(() => localStorage.getItem('hostVoice') || VoiceName.Kore);
  const [guestVoice, setGuestVoice] = useState(() => localStorage.getItem('guestVoice') || VoiceName.Puck);
  const [introFile, setIntroFile] = useState<StoredAudioFile | null>(null);
  const [outroFile, setOutroFile] = useState<StoredAudioFile | null>(null);
  const [musicSlots, setMusicSlots] = useState<(StoredAudioFile | null)[]>([null, null, null]);
  const [selectedMusicIndex, setSelectedMusicIndex] = useState<MusicSlotIndex>(-1);
  const [musicVolume, setMusicVolume] = useState(0.10); 
  const [introVolume, setIntroVolume] = useState(0.7); 
  const [outroVolume, setOutroVolume] = useState(0.7); 
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null); 
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSentSuccess, setEmailSentSuccess] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const intro = await getAudioFile('intro'); if (intro) setIntroFile(intro);
        const outro = await getAudioFile('outro'); if (outro) setOutroFile(outro);
        const slotA = await getAudioFile('music_0');
        const slotB = await getAudioFile('music_1');
        const slotC = await getAudioFile('music_2');
        setMusicSlots([slotA, slotB, slotC]);
        
        const sIdx = localStorage.getItem('selectedMusicIndex');
        if (sIdx) setSelectedMusicIndex(parseInt(sIdx) as MusicSlotIndex);
        const mVol = localStorage.getItem('musicVolume'); if (mVol) setMusicVolume(parseFloat(mVol));
        const iVol = localStorage.getItem('introVolume'); if (iVol) setIntroVolume(parseFloat(iVol));
        const oVol = localStorage.getItem('outroVolume'); if (oVol) setOutroVolume(parseFloat(oVol));
      } catch (e) {}
    };
    loadData();
  }, []);

  useEffect(() => localStorage.setItem('selectedMusicIndex', selectedMusicIndex.toString()), [selectedMusicIndex]);
  useEffect(() => localStorage.setItem('musicVolume', musicVolume.toString()), [musicVolume]);
  useEffect(() => localStorage.setItem('introVolume', introVolume.toString()), [introVolume]);
  useEffect(() => localStorage.setItem('outroVolume', outroVolume.toString()), [outroVolume]);
  useEffect(() => localStorage.setItem('hostVoice', hostVoice), [hostVoice]);
  useEffect(() => localStorage.setItem('guestVoice', guestVoice), [guestVoice]);

  const handleManualSave = () => {
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

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
    audio.onended = () => { setPlayingPreview(null); URL.revokeObjectURL(url); };
    previewAudioRef.current = audio;
    audio.play();
    setPlayingPreview(id);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'intro' | 'outro' | 'music', index?: number) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    try {
      if (type === 'intro') { await storeAudioFile('intro', file); setIntroFile({ name: file.name, blob: file }); }
      else if (type === 'outro') { await storeAudioFile('outro', file); setOutroFile({ name: file.name, blob: file }); }
      else if (type === 'music' && typeof index === 'number') {
        await storeAudioFile(`music_${index}`, file);
        const newSlots = [...musicSlots]; newSlots[index] = { name: file.name, blob: file };
        setMusicSlots(newSlots); setSelectedMusicIndex(index as MusicSlotIndex);
      }
    } catch (err) { alert("Failed to save file."); }
    e.target.value = '';
  };

  const handleFileDelete = async (type: 'intro' | 'outro' | 'music', index?: number) => {
    if (type === 'intro') { await deleteAudioFile('intro'); setIntroFile(null); if (playingPreview === 'intro') stopPreview(); }
    else if (type === 'outro') { await deleteAudioFile('outro'); setOutroFile(null); if (playingPreview === 'outro') stopPreview(); }
    else if (type === 'music' && typeof index === 'number') {
        await deleteAudioFile(`music_${index}`);
        const newSlots = [...musicSlots]; newSlots[index] = null; setMusicSlots(newSlots);
        if (selectedMusicIndex === index) setSelectedMusicIndex(-1);
        if (playingPreview === `music_${index}`) stopPreview();
    }
  };

  const handleVoicePreview = async (voice: string, id: 'host' | 'guest') => {
    if (playingPreview === id) { stopPreview(); return; }
    setPreviewLoading(id);
    try {
      const name = id === 'host' ? hostName : guestName;
      const text = `Hallo, ich bin ${voice}. Ich werde heute die Stimme von ${name} sein.`;
      const base64 = await generateVoicePreview(voice as VoiceName, text);
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = await decodeBase64Audio(base64, ctx);
      const blob = audioBufferToWav(buffer);
      await ctx.close();
      playPreviewAudio(blob, id);
    } catch (err) { alert("Preview failed"); } finally { setPreviewLoading(null); }
  };

  const handleGenerateAudio = async () => {
    if (!script.trim()) return;
    stopPreview(); setLoading(true); setError(null); setAudioUrl(null); setAudioBlob(null);
    try {
      const base64Data = await generatePodcastAudio(script, hostName, guestName, hostVoice as VoiceName, guestVoice as VoiceName);
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const voiceBuffer = await decodeBase64Audio(base64Data, ctx);
      let musicBuffer: AudioBuffer | null = null;
      if (selectedMusicIndex !== -1 && musicSlots[selectedMusicIndex]) musicBuffer = await decodeAudioBlob(musicSlots[selectedMusicIndex]!.blob, ctx);
      let introBuffer: AudioBuffer | null = null;
      if (introFile) introBuffer = await decodeAudioBlob(introFile.blob, ctx);
      let outroBuffer: AudioBuffer | null = null;
      if (outroFile) outroBuffer = await decodeAudioBlob(outroFile.blob, ctx);

      const mixedBuffer = await mixPodcastSequence(voiceBuffer, musicBuffer, introBuffer, outroBuffer, musicVolume, introVolume, outroVolume);
      const mp3Blob = audioBufferToMp3(mixedBuffer);
      const url = URL.createObjectURL(mp3Blob);
      setAudioUrl(url); setAudioBlob(mp3Blob);
      await ctx.close();
    } catch (err) { setError("Failed to generate audio."); } finally { setLoading(false); }
  };

  const openEmailModal = () => {
    const dateStr = new Date().toLocaleDateString('de-DE');
    const shortTopic = topic.length > 30 ? topic.substring(0, 27) + "..." : topic;
    const subject = `AI-Podcast: ${shortTopic} - ${dateStr}`;
    const scriptPreview = script.length > 800 ? script.substring(0, 800) + "..." : script;
    const body = `Hallo,\n\nhier ist die neue Podcast-Folge über "${topic}".\n\n🗣️ ${hostName} & ${guestName}\n📅 ${dateStr}\n\n📝 VORSCHAU:\n${scriptPreview}\n\nBeste Grüße,\nGemini Podcast Studio`;
    setEmailSubject(subject); setEmailBody(body); setEmailTo(''); setEmailSentSuccess(false); setShowEmailModal(true);
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim() || !audioBlob) return;
    setIsSendingEmail(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const filename = `AI-Podcast_${new Date().toISOString().slice(0,10)}.mp3`;
      const payload = { to: emailTo, subject: emailSubject, body: emailBody, attachmentName: filename, attachmentBase64: base64Audio };
      const response = await fetch(N8N_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("Server error");
      setIsSendingEmail(false); setEmailSentSuccess(true);
      setTimeout(() => setShowEmailModal(false), 2000);
    } catch (err) { setIsSendingEmail(false); alert("Fehler beim Senden."); }
  };

  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg transition-opacity duration-500 ${!script ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
      <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex justify-between">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2"><Volume2 className="w-5 h-5 text-purple-400" /> Step 2: Create Audio</h2>
        <button onClick={handleManualSave} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors text-xs font-medium">
          {saveStatus === 'saved' ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> Saved</> : <><Save className="w-3.5 h-3.5" /> Save Settings</>}
        </button>
      </div>
      <div className="p-6 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           {['host', 'guest'].map((role) => (
               <div key={role}>
                   <label className="block text-xs font-medium text-slate-500 mb-1.5">{role === 'host' ? hostName : guestName}</label>
                   <div className="flex gap-2">
                       <select value={role === 'host' ? hostVoice : guestVoice} onChange={(e) => role === 'host' ? setHostVoice(e.target.value) : setGuestVoice(e.target.value)} className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg py-3 px-4 focus:ring-2 focus:ring-purple-500">
                           {Object.values(VoiceName).map(v => <option key={v} value={v}>{v}</option>)}
                       </select>
                       <button onClick={() => handleVoicePreview(role === 'host' ? hostVoice : guestVoice, role as 'host'|'guest')} className="px-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-white">
                           {previewLoading === role ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                       </button>
                   </div>
               </div>
           ))}
        </div>
        <div className="h-px bg-slate-700/50" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {[introFile, outroFile].map((file, idx) => {
                 const type = idx === 0 ? 'intro' : 'outro';
                 const vol = idx === 0 ? introVolume : outroVolume;
                 const setVol = idx === 0 ? setIntroVolume : setOutroVolume;
                 return (
                    <div key={type} className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-sm font-medium text-white capitalize">{type}</span>
                            <div className="flex gap-2">
                                {file && (
                                    <>
                                    <button onClick={() => playPreviewAudio(file.blob, type)} className="text-purple-400 hover:text-white"><Play className="w-4 h-4" /></button>
                                    <button onClick={() => handleFileDelete(type as 'intro'|'outro')} className="text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                                    </>
                                )}
                            </div>
                        </div>
                        <label className="flex items-center gap-2 mb-3 bg-slate-800 py-2 px-3 rounded cursor-pointer hover:bg-slate-700 text-xs text-slate-400 truncate">
                            {file ? file.name : "Upload MP3..."}
                            <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, type as 'intro'|'outro')} />
                        </label>
                        <div className="flex items-center gap-2">
                            <Volume2 className="w-3 h-3 text-slate-500" />
                            <input type="range" min="0" max="1.2" step="0.1" value={vol} onChange={(e) => setVol(parseFloat(e.target.value))} className="w-full h-1 bg-slate-600 rounded-lg accent-purple-500" />
                        </div>
                    </div>
                 );
             })}
        </div>
        <div className="h-px bg-slate-700/50" />
        <div>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2"><Music className="w-4 h-4" /> Background Music</h3>
                {selectedMusicIndex !== -1 && (
                     <div className="flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-slate-400" /><input type="range" min="0" max="0.5" step="0.01" value={musicVolume} onChange={(e) => setMusicVolume(parseFloat(e.target.value))} className="w-24 h-1 bg-slate-600 rounded-lg accent-purple-500" />
                     </div>
                )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button onClick={() => { setSelectedMusicIndex(-1); stopPreview(); }} className={`p-3 rounded-lg border h-24 flex flex-col justify-center ${selectedMusicIndex === -1 ? 'bg-purple-600/20 border-purple-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>None</button>
                {musicSlots.map((slot, idx) => (
                    <div key={idx} className={`relative p-3 rounded-lg border h-24 flex flex-col justify-between ${selectedMusicIndex === idx ? 'bg-purple-600/20 border-purple-500' : 'bg-slate-900 border-slate-700'}`}>
                        {!slot ? (
                             <label className="flex flex-col justify-between h-full cursor-pointer">
                                <span className="text-sm font-medium text-slate-400">Music {['A','B','C'][idx]}</span>
                                <span className="text-xs text-purple-400 flex items-center gap-1"><Upload className="w-3 h-3" /> Upload</span>
                                <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'music', idx)} />
                             </label>
                        ) : (
                            <>
                                <div onClick={() => setSelectedMusicIndex(idx as MusicSlotIndex)} className="absolute inset-0 cursor-pointer" />
                                <div className="relative pointer-events-none"><div className="text-sm font-medium truncate pr-4 text-white">Music {['A','B','C'][idx]}</div><div className="text-[10px] text-slate-500 truncate">{slot.name}</div></div>
                                <div className="flex items-center justify-between relative z-10 mt-auto">
                                    <button onClick={() => playPreviewAudio(slot.blob, `music_${idx}`)} className="w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center text-slate-300 hover:text-white"><Play className="w-3 h-3" /></button>
                                    <button onClick={(e) => { e.stopPropagation(); handleFileDelete('music', idx); }} className="text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
        <div className="flex justify-end pt-4">
          <button onClick={handleGenerateAudio} disabled={loading || !script} className={`flex items-center gap-2 px-8 py-4 rounded-lg font-bold text-white shadow-xl ${loading ? 'bg-slate-700' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500'}`}>
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Mixing...</> : <><Music className="w-5 h-5" /> Generate Podcast</>}
          </button>
        </div>
        {audioUrl && (
          <div className="animate-fade-in bg-slate-900 rounded-xl p-6 border border-slate-700 shadow-inner">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-purple-600/20 flex items-center justify-center text-purple-400"><Music className="w-5 h-5" /></div><div><h3 className="text-white font-medium">Final Podcast</h3><p className="text-xs text-slate-500">320kbps MP3</p></div></div>
                <div className="flex gap-2">
                  <button onClick={openEmailModal} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-600"><Mail className="w-4 h-4" /> Email</button>
                  <a href={audioUrl} download={`AI-Podcast_${new Date().toISOString().slice(0,10)}.mp3`} className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg shadow-lg"><Download className="w-4 h-4" /> Download</a>
                </div>
              </div>
              <audio src={audioUrl} controls className="w-full h-10 accent-purple-500 rounded-lg" />
          </div>
        )}
      </div>
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl flex flex-col">
            <div className="p-6 border-b border-slate-800 flex justify-between"><h3 className="text-white font-semibold">E-Mail senden</h3><button onClick={() => setShowEmailModal(false)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
            <div className="p-6 space-y-4">
              <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="Empfänger E-Mail" className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white" />
              <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white" />
              <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={8} className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-slate-300 font-mono text-sm" />
            </div>
            <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
               <button onClick={() => setShowEmailModal(false)} className="px-4 py-2 text-slate-300">Abbrechen</button>
               <button onClick={handleSendEmail} disabled={isSendingEmail} className="px-6 py-2 bg-purple-600 rounded-lg text-white flex items-center gap-2">{isSendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : emailSentSuccess ? <CheckCircle2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- APP ENTRY ---

const App = () => {
  const [script, setScript] = useState('');
  const [topic, setTopic] = useState(() => localStorage.getItem('podcastTopic') || '');
  const [hostName, setHostName] = useState(() => localStorage.getItem('hostName') || 'Host');
  const [guestName, setGuestName] = useState(() => localStorage.getItem('guestName') || 'Guest');

  useEffect(() => localStorage.setItem('hostName', hostName), [hostName]);
  useEffect(() => localStorage.setItem('guestName', guestName), [guestName]);
  useEffect(() => localStorage.setItem('podcastTopic', topic), [topic]);

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 selection:bg-purple-500/30 pb-20">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <header className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-900/50 mb-4"><Mic2 className="w-8 h-8 text-white" /></div>
          <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">Gemini Podcast Studio</h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">Generate podcast scripts and audio with Gemini.</p>
        </header>
        <main className="space-y-8">
          <ScriptSection onScriptReady={setScript} hostName={hostName} setHostName={setHostName} guestName={guestName} setGuestName={setGuestName} topic={topic} setTopic={setTopic} />
          <AudioSection script={script} hostName={hostName} guestName={guestName} topic={topic} />
        </main>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);