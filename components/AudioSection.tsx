
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Play, Pause, Download, Loader2, Volume2, Music, Upload, Square, Trash2, Disc, Mail, X, Send, FileAudio, CheckCircle2 } from 'lucide-react';
import { VoiceName, MusicSlotIndex, StoredAudioFile } from '../types.ts';
import { generatePodcastAudio, generateVoicePreview } from '../services/geminiService.ts';
import { 
  decodeBase64Audio, 
  decodeAudioBlob,
  audioBufferToWav, 
  audioBufferToMp3, 
  mixPodcastSequence,
  storeAudioFile,
  getAudioFile,
  deleteAudioFile,
  blobToBase64
} from '../utils/audioUtils.ts';

interface AudioSectionProps {
  script: string;
  hostName: string;
  guestName: string;
  topic: string;
}

// Hardcoded N8N Webhook URL
const N8N_WEBHOOK_URL = 'https://anymal.app.n8n.cloud/webhook/send_mail';

const AudioSection: React.FC<AudioSectionProps> = ({ script, hostName, guestName, topic }) => {
  // Initialize with storage or default
  const [hostVoice, setHostVoice] = useState<VoiceName>(() => (localStorage.getItem('hostVoice') as VoiceName) || VoiceName.Kore);
  const [guestVoice, setGuestVoice] = useState<VoiceName>(() => (localStorage.getItem('guestVoice') as VoiceName) || VoiceName.Puck);
  
  // Files State
  const [introFile, setIntroFile] = useState<StoredAudioFile | null>(null);
  const [outroFile, setOutroFile] = useState<StoredAudioFile | null>(null);
  // Fixed slots for Music A, B, C
  const [musicSlots, setMusicSlots] = useState<(StoredAudioFile | null)[]>([null, null, null]);
  
  // Selection State
  const [selectedMusicIndex, setSelectedMusicIndex] = useState<MusicSlotIndex>(-1);
  
  // Volume States (with defaults)
  const [musicVolume, setMusicVolume] = useState<number>(0.10); 
  const [introVolume, setIntroVolume] = useState<number>(0.7); 
  const [outroVolume, setOutroVolume] = useState<number>(0.7); 
  
  // Generation State
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Preview State
  const [previewLoading, setPreviewLoading] = useState<string | null>(null); 
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  
  // Email Modal State
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSentSuccess, setEmailSentSuccess] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // --- Initialization: Load from DB & LocalStorage ---
  useEffect(() => {
    const loadData = async () => {
      try {
        const intro = await getAudioFile('intro');
        if (intro) setIntroFile(intro);

        const outro = await getAudioFile('outro');
        if (outro) setOutroFile(outro);

        const slotA = await getAudioFile('music_0');
        const slotB = await getAudioFile('music_1');
        const slotC = await getAudioFile('music_2');
        
        setMusicSlots([slotA, slotB, slotC]);

        // Restore selection and volumes
        const savedIndex = localStorage.getItem('selectedMusicIndex');
        if (savedIndex !== null) setSelectedMusicIndex(parseInt(savedIndex) as MusicSlotIndex);

        const savedVol = localStorage.getItem('musicVolume');
        if (savedVol !== null) setMusicVolume(parseFloat(savedVol));

        const savedIntroVol = localStorage.getItem('introVolume');
        if (savedIntroVol !== null) setIntroVolume(parseFloat(savedIntroVol));

        const savedOutroVol = localStorage.getItem('outroVolume');
        if (savedOutroVol !== null) setOutroVolume(parseFloat(savedOutroVol));

      } catch (e) {
        console.error("Failed to load stored audio files", e);
      }
    };
    loadData();
  }, []);

  // --- Persistence: Save Metadata ---
  useEffect(() => {
    localStorage.setItem('selectedMusicIndex', selectedMusicIndex.toString());
  }, [selectedMusicIndex]);

  useEffect(() => {
    localStorage.setItem('musicVolume', musicVolume.toString());
  }, [musicVolume]);

  useEffect(() => {
    localStorage.setItem('introVolume', introVolume.toString());
  }, [introVolume]);

  useEffect(() => {
    localStorage.setItem('outroVolume', outroVolume.toString());
  }, [outroVolume]);

  useEffect(() => {
    localStorage.setItem('hostVoice', hostVoice);
  }, [hostVoice]);

  useEffect(() => {
    localStorage.setItem('guestVoice', guestVoice);
  }, [guestVoice]);

  // --- Clean up ---
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      stopPreview();
    };
  }, [audioUrl]);


  // --- Handlers ---

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'intro' | 'outro' | 'music', index?: number) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];

    try {
      if (type === 'intro') {
        await storeAudioFile('intro', file);
        setIntroFile({ name: file.name, blob: file });
      } else if (type === 'outro') {
        await storeAudioFile('outro', file);
        setOutroFile({ name: file.name, blob: file });
      } else if (type === 'music' && typeof index === 'number') {
        await storeAudioFile(`music_${index}`, file);
        const newSlots = [...musicSlots];
        newSlots[index] = { name: file.name, blob: file };
        setMusicSlots(newSlots);
        setSelectedMusicIndex(index as MusicSlotIndex); // Auto select uploaded
      }
    } catch (err) {
      console.error("Failed to save file", err);
      alert("Failed to save file to local storage.");
    }
    // Reset input
    e.target.value = '';
  };

  const handleFileDelete = async (type: 'intro' | 'outro' | 'music', index?: number) => {
    try {
      if (type === 'intro') {
        await deleteAudioFile('intro');
        setIntroFile(null);
        if (playingPreview === 'intro') stopPreview();
      } else if (type === 'outro') {
        await deleteAudioFile('outro');
        setOutroFile(null);
        if (playingPreview === 'outro') stopPreview();
      } else if (type === 'music' && typeof index === 'number') {
        await deleteAudioFile(`music_${index}`);
        const newSlots = [...musicSlots];
        newSlots[index] = null;
        setMusicSlots(newSlots);
        if (selectedMusicIndex === index) setSelectedMusicIndex(-1);
        if (playingPreview === `music_${index}`) stopPreview();
      }
    } catch (err) {
      console.error("Failed to delete file", err);
      alert("Failed to delete file.");
    }
  };

  const handlePreviewFile = (file: StoredAudioFile | null, id: string) => {
    if (!file) return;
    if (playingPreview === id) {
      stopPreview();
    } else {
      playPreviewAudio(file.blob, id);
    }
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

  const handleGenerateAudio = async () => {
    if (!script.trim()) return;
    stopPreview();
    setLoading(true);
    setError(null);
    setAudioUrl(null);
    setAudioBlob(null);

    try {
      // 1. Get Voice Audio
      const base64Data = await generatePodcastAudio(script, hostName, guestName, hostVoice, guestVoice);
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const voiceBuffer = await decodeBase64Audio(base64Data, ctx);

      // 2. Prepare BG Music
      let musicBuffer: AudioBuffer | null = null;
      if (selectedMusicIndex !== -1 && musicSlots[selectedMusicIndex]) {
        musicBuffer = await decodeAudioBlob(musicSlots[selectedMusicIndex]!.blob, ctx);
      }

      // 3. Prepare Intro
      let introBuffer: AudioBuffer | null = null;
      if (introFile) {
        introBuffer = await decodeAudioBlob(introFile.blob, ctx);
      }

      // 4. Prepare Outro
      let outroBuffer: AudioBuffer | null = null;
      if (outroFile) {
        outroBuffer = await decodeAudioBlob(outroFile.blob, ctx);
      }

      // 5. Mix Sequence (Async now)
      const mixedBuffer = await mixPodcastSequence(
        voiceBuffer, 
        musicBuffer, 
        introBuffer, 
        outroBuffer, 
        musicVolume,
        introVolume,
        outroVolume
      );

      // 6. Encode
      const mp3Blob = audioBufferToMp3(mixedBuffer);
      const url = URL.createObjectURL(mp3Blob);
      setAudioUrl(url);
      setAudioBlob(mp3Blob);
      
      await ctx.close();

    } catch (err) {
      console.error(err);
      setError("Failed to generate audio. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const openEmailModal = () => {
    // Prepare default content in German
    const dateStr = new Date().toLocaleDateString('de-DE');
    const shortTopic = topic.length > 30 ? topic.substring(0, 27) + "..." : topic;
    const subject = `AI-Podcast: ${shortTopic} - ${dateStr}`;
    const scriptPreview = script.length > 800 ? script.substring(0, 800) + "..." : script;
    
    const body = `Hallo,

hier ist die neue Podcast-Folge, die wir über "${topic}" generiert haben.

🎙️ THEMA: ${topic}
🗣️ SPRECHER: ${hostName} & ${guestName}
📅 DATUM: ${dateStr}

📝 SKRIPT VORSCHAU:
================================
${scriptPreview}
================================

Beste Grüße,
Gemini Podcast Studio`;

    setEmailSubject(subject);
    setEmailBody(body);
    setEmailTo('');
    setEmailSentSuccess(false);
    setShowEmailModal(true);
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim() || !audioBlob) return;
    setIsSendingEmail(true);

    try {
      const base64Audio = await blobToBase64(audioBlob);
      const filename = `AI-Podcast_${new Date().toISOString().slice(0,10)}.mp3`;

      const payload = {
        to: emailTo,
        subject: emailSubject,
        body: emailBody,
        attachmentName: filename,
        attachmentBase64: base64Audio
      };

      const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      setIsSendingEmail(false);
      setEmailSentSuccess(true);
      
      // Close modal after success
      setTimeout(() => {
        setShowEmailModal(false);
      }, 2000);

    } catch (err) {
      console.error("Email send failed", err);
      setIsSendingEmail(false);
      alert("Fehler beim Senden der E-Mail. Bitte versuchen Sie es erneut.");
    }
  };

  // Helper Component for Music Cards
  const MusicSlotCard = ({ index, label }: { index: number, label: string }) => {
    const slot = musicSlots[index];
    const isSelected = selectedMusicIndex === index;
    const isPreviewing = playingPreview === `music_${index}`;

    return (
      <div className={`relative p-3 rounded-lg border transition-all group h-24 flex flex-col justify-between
        ${isSelected ? 'bg-purple-600/20 border-purple-500 ring-1 ring-purple-500/50' : 'bg-slate-900 border-slate-700 hover:border-slate-500'}
      `}>
        {!slot ? (
          <>
             <div className="text-sm font-medium text-slate-400 mb-1">{label}</div>
             <label className="flex items-center gap-2 text-xs text-purple-400 cursor-pointer hover:text-purple-300 mt-auto">
               <Upload className="w-3 h-3" /> Upload MP3
               <input 
                 type="file" 
                 accept="audio/*" 
                 className="hidden" 
                 onChange={(e) => handleFileUpload(e, 'music', index)} 
               />
             </label>
          </>
        ) : (
          <>
            <div 
              onClick={() => setSelectedMusicIndex(index as MusicSlotIndex)}
              className="absolute inset-0 cursor-pointer"
            />
            <div className="flex justify-between items-start relative pointer-events-none">
               <div>
                 <div className={`text-sm font-medium truncate pr-6 ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                   {label}
                 </div>
                 <div className="text-[10px] text-slate-500 truncate max-w-[100px]" title={slot.name}>{slot.name}</div>
               </div>
            </div>
            
            <div className="flex items-center justify-between mt-auto relative z-10">
                <button
                  onClick={() => handlePreviewFile(slot, `music_${index}`)}
                  className="w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center hover:bg-slate-600 hover:text-white text-slate-300 transition-colors"
                >
                   {isPreviewing ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
                </button>
                
                <button 
                  className="p-1.5 text-slate-500 hover:text-red-400 cursor-pointer z-20"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFileDelete('music', index);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg transition-opacity duration-500 ${!script ? 'opacity-50 pointer-events-none blur-[1px]' : 'opacity-100'}`}>
      <div className="p-6 border-b border-slate-700 bg-slate-900/50">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-purple-400" />
          Step 2: Create Audio
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Assign voices, intro/outro, and background atmosphere.
        </p>
      </div>

      <div className="p-6 space-y-8">
        {/* Voice Selection */}
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Mic className="w-4 h-4" /> Cast
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">{hostName}</label>
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
                            {previewLoading === 'host' ? <Loader2 className="w-4 h-4 animate-spin" /> : playingPreview === 'host' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                        </button>
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">{guestName}</label>
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
                             {previewLoading === 'guest' ? <Loader2 className="w-4 h-4 animate-spin" /> : playingPreview === 'guest' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div className="h-px bg-slate-700/50" />

        {/* Intro / Outro */}
        <div className="space-y-4">
             <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Disc className="w-4 h-4" /> Intro & Outro
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {/* Intro */}
               <div className={`bg-slate-900 rounded-lg p-4 border ${introFile ? 'border-purple-500/50' : 'border-slate-700'}`}>
                  <div className="flex justify-between items-start mb-2">
                     <span className="text-sm font-medium text-white">Intro</span>
                     <div className="flex gap-2">
                       {introFile && (
                          <>
                            <button onClick={() => handlePreviewFile(introFile, 'intro')} className="text-purple-400 hover:text-white">
                               {playingPreview === 'intro' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                            </button>
                            <button onClick={() => handleFileDelete('intro')} className="text-slate-500 hover:text-red-400">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                       )}
                     </div>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                      <label className="flex-1 truncate text-xs text-slate-400 bg-slate-800 py-2 px-3 rounded cursor-pointer hover:bg-slate-700 transition-colors">
                          {introFile ? introFile.name : "Upload MP3..."}
                          <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'intro')} />
                      </label>
                  </div>
                  {/* Intro Volume */}
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-3 h-3 text-slate-500" />
                    <input 
                        type="range" 
                        min="0" 
                        max="1.2" 
                        step="0.1" 
                        value={introVolume}
                        onChange={(e) => setIntroVolume(parseFloat(e.target.value))}
                        className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        title={`Volume: ${Math.round(introVolume * 100)}%`}
                    />
                    <span className="text-[10px] text-slate-500 w-6 text-right">{Math.round(introVolume * 100)}%</span>
                  </div>
               </div>

               {/* Outro */}
               <div className={`bg-slate-900 rounded-lg p-4 border ${outroFile ? 'border-purple-500/50' : 'border-slate-700'}`}>
                  <div className="flex justify-between items-start mb-2">
                     <span className="text-sm font-medium text-white">Outro</span>
                     <div className="flex gap-2">
                       {outroFile && (
                          <>
                            <button onClick={() => handlePreviewFile(outroFile, 'outro')} className="text-purple-400 hover:text-white">
                               {playingPreview === 'outro' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                            </button>
                             <button onClick={() => handleFileDelete('outro')} className="text-slate-500 hover:text-red-400">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                       )}
                     </div>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                      <label className="flex-1 truncate text-xs text-slate-400 bg-slate-800 py-2 px-3 rounded cursor-pointer hover:bg-slate-700 transition-colors">
                          {outroFile ? outroFile.name : "Upload MP3..."}
                          <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'outro')} />
                      </label>
                  </div>
                   {/* Outro Volume */}
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-3 h-3 text-slate-500" />
                    <input 
                        type="range" 
                        min="0" 
                        max="1.2" 
                        step="0.1" 
                        value={outroVolume}
                        onChange={(e) => setOutroVolume(parseFloat(e.target.value))}
                        className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        title={`Volume: ${Math.round(outroVolume * 100)}%`}
                    />
                    <span className="text-[10px] text-slate-500 w-6 text-right">{Math.round(outroVolume * 100)}%</span>
                  </div>
               </div>
            </div>
        </div>

        <div className="h-px bg-slate-700/50" />

        {/* Background Music */}
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Music className="w-4 h-4" /> Background Music
                </h3>
                {selectedMusicIndex !== -1 && (
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
                {/* None Option */}
                <button 
                    onClick={() => { setSelectedMusicIndex(-1); stopPreview(); }}
                    className={`p-3 rounded-lg border text-left transition-all h-24 flex flex-col justify-center ${selectedMusicIndex === -1 ? 'bg-purple-600/20 border-purple-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                >
                    <div className="text-sm font-medium">None</div>
                    <div className="text-xs opacity-70 mt-1">Voice only</div>
                </button>

                <MusicSlotCard index={0} label="Music A" />
                <MusicSlotCard index={1} label="Music B" />
                <MusicSlotCard index={2} label="Music C" />
            </div>
        </div>

        {/* Action Area */}
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
                   Mixing Audio...
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
                        320kbps MP3 • {introFile && 'Intro + '}Dialog{selectedMusicIndex !== -1 && ' + BG Music'}{outroFile && ' + Outro'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={openEmailModal}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors border border-slate-600"
                    title="Send via Email"
                  >
                    <Mail className="w-4 h-4" />
                    <span className="text-sm font-medium">Email</span>
                  </button>
                  <a
                    href={audioUrl}
                    download={`AI-Podcast_${new Date().toISOString().slice(0,10)}.mp3`}
                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors shadow-lg shadow-purple-900/20"
                    title="Download MP3"
                  >
                    <Download className="w-4 h-4" />
                    <span className="text-sm font-medium">Download</span>
                  </a>
                </div>
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

      {/* EMAIL MODAL */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowEmailModal(false)} />
          <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-800">
               <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                 <Mail className="w-5 h-5 text-purple-400" /> Podcast per E-Mail versenden
               </h3>
               <button onClick={() => setShowEmailModal(false)} className="text-slate-400 hover:text-white">
                 <X className="w-5 h-5" />
               </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">An (Empfänger)</label>
                <input 
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="freund@beispiel.de"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Betreff</label>
                <input 
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Nachricht</label>
                <textarea 
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={8}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                />
              </div>

              <div className="flex items-center gap-3 p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                <div className="w-10 h-10 bg-purple-600/20 rounded flex items-center justify-center text-purple-400">
                  <FileAudio className="w-5 h-5" />
                </div>
                <div>
                   <div className="text-sm font-medium text-white">podcast_episode.mp3</div>
                   <div className="text-xs text-slate-500">High Quality MP3 • Anhang</div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-900 rounded-b-xl">
               <button 
                 onClick={() => setShowEmailModal(false)}
                 className="px-4 py-2 text-slate-300 hover:text-white transition-colors font-medium"
               >
                 Abbrechen
               </button>
               <button 
                 onClick={handleSendEmail}
                 disabled={isSendingEmail || !emailTo.trim()}
                 className={`px-6 py-2 rounded-lg flex items-center gap-2 font-medium text-white transition-all
                   ${isSendingEmail || !emailTo.trim()
                     ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                     : 'bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-900/20'
                   }
                 `}
               >
                 {isSendingEmail ? (
                   <>
                     <Loader2 className="w-4 h-4 animate-spin" /> Senden...
                   </>
                 ) : emailSentSuccess ? (
                   <>
                     <CheckCircle2 className="w-4 h-4" /> Gesendet!
                   </>
                 ) : (
                   <>
                     <Send className="w-4 h-4" /> Abschicken
                   </>
                 )}
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioSection;
