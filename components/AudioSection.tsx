import React, { useState, useRef, useEffect } from 'react';
import { Mic, Play, Pause, Download, Loader2, Volume2, Music, Upload, Square, Trash2, Disc, Mail, X, Send, FileAudio, CheckCircle2, Save } from 'lucide-react';
import { VoiceName, MusicSlotIndex, StoredAudioFile, RssArticle } from '../types.ts';
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
  rssArticles?: RssArticle[];
  searchSources?: { title: string; uri: string }[];
}

const N8N_WEBHOOK_URL = 'https://anymal.app.n8n.cloud/webhook/send_mail';

const AudioSection: React.FC<AudioSectionProps> = ({ script, hostName, guestName, topic, rssArticles, searchSources }) => {
  const [hostVoice, setHostVoice] = useState<VoiceName>(() => (localStorage.getItem('hostVoice') as VoiceName) || VoiceName.Kore);
  const [guestVoice, setGuestVoice] = useState<VoiceName>(() => (localStorage.getItem('guestVoice') as VoiceName) || VoiceName.Puck);
  
  const [introFile, setIntroFile] = useState<StoredAudioFile | null>(null);
  const [outroFile, setOutroFile] = useState<StoredAudioFile | null>(null);
  const [musicSlots, setMusicSlots] = useState<(StoredAudioFile | null)[]>([null, null, null]);
  
  const [selectedMusicIndex, setSelectedMusicIndex] = useState<MusicSlotIndex>(() => {
    const saved = localStorage.getItem('selectedMusicIndex');
    return saved !== null ? parseInt(saved) as MusicSlotIndex : -1;
  });
  
  const [musicVolume, setMusicVolume] = useState<number>(() => {
    const saved = localStorage.getItem('musicVolume');
    const val = saved !== null ? parseFloat(saved) : 0.10;
    return isNaN(val) ? 0.10 : val;
  });

  const [introVolume, setIntroVolume] = useState<number>(() => {
    const saved = localStorage.getItem('introVolume');
    const val = saved !== null ? parseFloat(saved) : 0.5;
    return isNaN(val) ? 0.5 : val;
  });

  const [outroVolume, setOutroVolume] = useState<number>(() => {
    const saved = localStorage.getItem('outroVolume');
    const val = saved !== null ? parseFloat(saved) : 0.5;
    return isNaN(val) ? 0.5 : val;
  });
  
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

  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

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
      } catch (e) {
        console.error("Failed to load stored audio files", e);
      }
    };
    loadData();
  }, []);

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

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      stopPreview();
    };
  }, [audioUrl]);


  const handleManualSave = () => {
    try {
      localStorage.setItem('hostVoice', hostVoice);
      localStorage.setItem('guestVoice', guestVoice);
      localStorage.setItem('selectedMusicIndex', selectedMusicIndex.toString());
      localStorage.setItem('musicVolume', musicVolume.toString());
      localStorage.setItem('introVolume', introVolume.toString());
      localStorage.setItem('outroVolume', outroVolume.toString());
      
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      console.error("Save failed", e);
      alert("Could not save settings.");
    }
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
        setSelectedMusicIndex(index as MusicSlotIndex);
      }
    } catch (err) {
      console.error("Failed to save file", err);
      alert("Failed to save file to local storage.");
    }
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

    let ctx: AudioContext | null = null;

    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const base64Data = await generatePodcastAudio(script, hostName, guestName, hostVoice, guestVoice);
      const voiceBuffer = await decodeBase64Audio(base64Data, ctx);

      let musicBuffer: AudioBuffer | null = null;
      if (selectedMusicIndex !== -1 && musicSlots[selectedMusicIndex]) {
        musicBuffer = await decodeAudioBlob(musicSlots[selectedMusicIndex]!.blob, ctx);
      }

      let introBuffer: AudioBuffer | null = null;
      if (introFile) {
        introBuffer = await decodeAudioBlob(introFile.blob, ctx);
      }

      let outroBuffer: AudioBuffer | null = null;
      if (outroFile) {
        outroBuffer = await decodeAudioBlob(outroFile.blob, ctx);
      }

      const mixedBuffer = await mixPodcastSequence(
        voiceBuffer, 
        musicBuffer, 
        introBuffer, 
        outroBuffer, 
        musicVolume,
        introVolume,
        outroVolume
      );

      const mp3Blob = audioBufferToMp3(mixedBuffer);
      const url = URL.createObjectURL(mp3Blob);
      setAudioUrl(url);
      setAudioBlob(mp3Blob);

    } catch (err: any) {
      console.error("Audio Generation Error:", err);
      setError(err.message || "Failed to generate audio. Please try again.");
    } finally {
      if (ctx) {
        await ctx.close();
      }
      setLoading(false);
    }
  };

  const openEmailModal = () => {
    const dateStr = new Date().toLocaleDateString('de-DE');
    const shortTopic = topic.length > 30 ? topic.substring(0, 27) + "..." : topic;
    const subject = `AI-Podcast: ${shortTopic} - ${dateStr}`;
    
    let sourcesSection = "";
    let hasSources = false;

    if (rssArticles && rssArticles.length > 0) {
        sourcesSection += "\n\n🔗 RSS QUELLEN:\n================================";
        rssArticles.forEach(article => {
            sourcesSection += `\n• ${article.title} (${article.source})\n  ${article.link || "Kein Link verfügbar"}\n`;
        });
        sourcesSection += "================================";
        hasSources = true;
    }

    if (searchSources && searchSources.length > 0) {
        sourcesSection += `${hasSources ? '\n' : '\n\n'}🔗 WEB QUELLEN (Google):\n================================`;
        searchSources.forEach(source => {
            sourcesSection += `\n• ${source.title}\n  ${source.uri}\n`;
        });
        sourcesSection += "================================";
    }

    const body = `Hallo,

hier ist die neue Podcast-Folge, die wir über "${topic}" generiert haben.

🎙️ THEMA: ${topic}
🗣️ SPRECHER: ${hostName} & ${guestName}
📅 DATUM: ${dateStr}

Die MP3-Datei finden Sie im Anhang.${sourcesSection}

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

      const sendRequest = async (url: string) => {
         return fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
         });
      };

      let response;
      
      try {
         console.log("Versuche direkten Versand an n8n...");
         response = await sendRequest(N8N_WEBHOOK_URL);
      } catch (directError) {
         console.warn("Direkter Versand fehlgeschlagen (CORS?), versuche Proxy...", directError);
         const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(N8N_WEBHOOK_URL)}`;
         response = await sendRequest(proxyUrl);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Server error: ${response.status} ${text}`);
      }

      setIsSendingEmail(false);
      setEmailSentSuccess(true);
      
      setTimeout(() => {
        setShowEmailModal(false);
      }, 2000);

    } catch (err: any) {
      console.error("Email send failed", err);
      setIsSendingEmail(false);
      alert(`Fehler beim Senden der E-Mail: ${err.message || "Netzwerkfehler"}.\n\nMögliche Ursache: Die MP3-Datei ist zu groß für den Webhook oder Proxy (>5MB).`);
    }
  };

  const MusicSlotCard = ({ index, label }: { index: number, label: string }) => {
    const slot = musicSlots[index];
    const isSelected = selectedMusicIndex === index;
    const isPreviewing = playingPreview === `music_${index}`;

    return (
      <div className={`relative p-4 rounded-2xl border transition-all group h-32 flex flex-col justify-between cursor-pointer
        ${isSelected 
            ? 'bg-[rgba(192,174,102,0.15)] border-[#c0ae66] shadow-md' 
            : 'bg-white border-[rgba(0,0,0,0.05)] hover:bg-[#fdfcf8] hover:border-[rgba(192,174,102,0.5)] hover:shadow-lg'
        }
      `}>
        {!slot ? (
          <>
             <div className="text-sm font-medium text-[#181818] mb-1">{label}</div>
             <label className="flex items-center justify-center gap-2 text-xs text-[#c0ae66] font-medium cursor-pointer hover:text-[#a08e46] mt-auto w-full h-full border-2 border-dashed border-[rgba(0,0,0,0.08)] rounded-xl hover:border-[#c0ae66]">
               <Upload className="w-4 h-4" /> Upload MP3
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
              className="absolute inset-0 cursor-pointer rounded-2xl"
            />
            <div className="flex justify-between items-start relative pointer-events-none z-10">
               <div className="w-full">
                 <div className="text-sm font-medium truncate text-[#181818]">
                   {label}
                 </div>
                 <div className="text-[11px] text-[#717684] truncate w-full mt-1" title={slot.name}>{slot.name}</div>
               </div>
            </div>
            
            <div className="flex items-center justify-between mt-auto relative z-20 pt-2">
                <button
                  onClick={() => handlePreviewFile(slot, `music_${index}`)}
                  className="w-8 h-8 bg-[#f1f5f9] rounded-full flex items-center justify-center hover:bg-[#c0ae66] hover:text-white text-[#717684] transition-colors shadow-sm"
                >
                   {isPreviewing ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                </button>
                
                <button 
                  className="p-2 text-[#717684] hover:text-[#c0392b] cursor-pointer transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFileDelete('music', index);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`card p-8 transition-opacity duration-500 hover:shadow-xl ${!script ? 'opacity-50 pointer-events-none blur-[1px]' : 'opacity-100'}`}>
      <div className="border-b border-[#c0ae66] pb-4 mb-8 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-medium text-[#181818] flex items-center gap-2 tracking-wide">
            <Volume2 className="w-5 h-5 text-[#c0ae66]" />
            SCHRITT 2: AUDIO ERSTELLEN
          </h2>
          <p className="text-[#717684] text-sm mt-1">
            Stimmen, Intro/Outro und Hintergrund-Atmosphäre festlegen.
          </p>
        </div>
        <button
          onClick={handleManualSave}
          className="flex items-center gap-2 px-4 py-2 rounded-full border border-[rgba(0,0,0,0.1)] bg-[#f9f9f9] text-[#717684] hover:text-[#181818] hover:bg-white transition-colors text-xs font-medium shadow-sm"
          title="Save current settings"
        >
          {saveStatus === 'saved' ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#27ae60]" />
              <span className="text-[#27ae60]">Gespeichert</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              Speichern
            </>
          )}
        </button>
      </div>

      <div className="space-y-10">
        {/* Voice Selection */}
        <div className="space-y-4">
            <h3 className="text-xs font-semibold text-[#181818] uppercase tracking-wider flex items-center gap-2">
                <Mic className="w-3.5 h-3.5 text-[#717684]" /> Stimmen-Besetzung
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#f9f9f9] p-4 rounded-2xl border border-[rgba(0,0,0,0.05)]">
                    <label className="block text-xs font-medium text-[#717684] mb-2 uppercase">{hostName}</label>
                    <div className="flex gap-3">
                        <div className="relative flex-1">
                            <select
                            value={hostVoice}
                            onChange={(e) => setHostVoice(e.target.value as VoiceName)}
                            className="w-full appearance-none rounded-xl py-3 px-4 pr-8 transition-all cursor-pointer"
                            >
                            {Object.values(VoiceName).map((v) => (
                                <option key={v} value={v}>{v}</option>
                            ))}
                            </select>
                        </div>
                        <button
                            onClick={() => handleVoicePreview(hostVoice, 'host')}
                            disabled={previewLoading !== null && previewLoading !== 'host'}
                            className="w-12 bg-white border border-[rgba(0,0,0,0.08)] hover:border-[#c0ae66] rounded-xl text-[#181818] transition-colors flex items-center justify-center shadow-sm"
                        >
                            {previewLoading === 'host' ? <Loader2 className="w-4 h-4 animate-spin" /> : playingPreview === 'host' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                        </button>
                    </div>
                </div>
                <div className="bg-[#f9f9f9] p-4 rounded-2xl border border-[rgba(0,0,0,0.05)]">
                    <label className="block text-xs font-medium text-[#717684] mb-2 uppercase">{guestName}</label>
                    <div className="flex gap-3">
                        <div className="relative flex-1">
                            <select
                            value={guestVoice}
                            onChange={(e) => setGuestVoice(e.target.value as VoiceName)}
                            className="w-full appearance-none rounded-xl py-3 px-4 pr-8 transition-all cursor-pointer"
                            >
                            {Object.values(VoiceName).map((v) => (
                                <option key={v} value={v}>{v}</option>
                            ))}
                            </select>
                        </div>
                        <button
                            onClick={() => handleVoicePreview(guestVoice, 'guest')}
                            disabled={previewLoading !== null && previewLoading !== 'guest'}
                            className="w-12 bg-white border border-[rgba(0,0,0,0.08)] hover:border-[#c0ae66] rounded-xl text-[#181818] transition-colors flex items-center justify-center shadow-sm"
                        >
                             {previewLoading === 'guest' ? <Loader2 className="w-4 h-4 animate-spin" /> : playingPreview === 'guest' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        {/* Intro / Outro */}
        <div className="space-y-4">
             <h3 className="text-xs font-semibold text-[#181818] uppercase tracking-wider flex items-center gap-2">
                <Disc className="w-3.5 h-3.5 text-[#717684]" /> Intro & Outro
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               {/* Intro */}
               <div className={`rounded-2xl p-5 border transition-colors ${introFile ? 'bg-[#fcfcfc] border-[#c0ae66]' : 'bg-[#f9f9f9] border-[rgba(0,0,0,0.05)]'}`}>
                  <div className="flex justify-between items-start mb-3">
                     <span className="text-sm font-medium text-[#181818]">Intro</span>
                     <div className="flex gap-2">
                       {introFile && (
                          <>
                            <button onClick={() => handlePreviewFile(introFile, 'intro')} className="text-[#c0ae66] hover:text-[#a08e46]">
                               {playingPreview === 'intro' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                            </button>
                            <button onClick={() => handleFileDelete('intro')} className="text-[#717684] hover:text-[#c0392b]">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                       )}
                     </div>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                      <label className="flex-1 truncate text-xs text-[#717684] bg-white border border-[rgba(0,0,0,0.08)] py-3 px-4 rounded-xl cursor-pointer hover:border-[#c0ae66] transition-colors shadow-sm">
                          {introFile ? introFile.name : "Datei auswählen (MP3)..."}
                          <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'intro')} />
                      </label>
                  </div>
                  {/* Intro Volume */}
                  <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-[rgba(0,0,0,0.03)]">
                    <Volume2 className="w-3.5 h-3.5 text-[#717684]" />
                    <input 
                        type="range" 
                        min="0" 
                        max="1.2" 
                        step="0.1" 
                        value={introVolume}
                        onChange={(e) => setIntroVolume(parseFloat(e.target.value))}
                        className="w-full h-1 bg-[#e5e5e5] rounded-lg appearance-none cursor-pointer accent-[#c0ae66]"
                        title={`Volume: ${Math.round(introVolume * 100)}%`}
                    />
                    <span className="text-[10px] text-[#717684] w-8 text-right font-mono">{Math.round(introVolume * 100)}%</span>
                  </div>
               </div>

               {/* Outro */}
               <div className={`rounded-2xl p-5 border transition-colors ${outroFile ? 'bg-[#fcfcfc] border-[#c0ae66]' : 'bg-[#f9f9f9] border-[rgba(0,0,0,0.05)]'}`}>
                  <div className="flex justify-between items-start mb-3">
                     <span className="text-sm font-medium text-[#181818]">Outro</span>
                     <div className="flex gap-2">
                       {outroFile && (
                          <>
                            <button onClick={() => handlePreviewFile(outroFile, 'outro')} className="text-[#c0ae66] hover:text-[#a08e46]">
                               {playingPreview === 'outro' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                            </button>
                             <button onClick={() => handleFileDelete('outro')} className="text-[#717684] hover:text-[#c0392b]">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                       )}
                     </div>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
                      <label className="flex-1 truncate text-xs text-[#717684] bg-white border border-[rgba(0,0,0,0.08)] py-3 px-4 rounded-xl cursor-pointer hover:border-[#c0ae66] transition-colors shadow-sm">
                          {outroFile ? outroFile.name : "Datei auswählen (MP3)..."}
                          <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'outro')} />
                      </label>
                  </div>
                   {/* Outro Volume */}
                  <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-[rgba(0,0,0,0.03)]">
                    <Volume2 className="w-3.5 h-3.5 text-[#717684]" />
                    <input 
                        type="range" 
                        min="0" 
                        max="1.2" 
                        step="0.1" 
                        value={outroVolume}
                        onChange={(e) => setOutroVolume(parseFloat(e.target.value))}
                        className="w-full h-1 bg-[#e5e5e5] rounded-lg appearance-none cursor-pointer accent-[#c0ae66]"
                        title={`Volume: ${Math.round(outroVolume * 100)}%`}
                    />
                    <span className="text-[10px] text-[#717684] w-8 text-right font-mono">{Math.round(outroVolume * 100)}%</span>
                  </div>
               </div>
            </div>
        </div>

        {/* Background Music */}
        <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-[rgba(0,0,0,0.05)] pb-2">
                <h3 className="text-xs font-semibold text-[#181818] uppercase tracking-wider flex items-center gap-2">
                    <Music className="w-3.5 h-3.5 text-[#717684]" /> Hintergrund-Musik
                </h3>
                {selectedMusicIndex !== -1 && (
                     <div className="flex items-center gap-3">
                        <Volume2 className="w-3.5 h-3.5 text-[#717684]" />
                        <input 
                            type="range" 
                            min="0" 
                            max="0.5" 
                            step="0.01" 
                            value={musicVolume}
                            onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
                            className="w-24 h-1 bg-[#e5e5e5] rounded-lg appearance-none cursor-pointer accent-[#c0ae66]"
                        />
                        <span className="text-xs text-[#717684] w-8 font-mono">{Math.round(musicVolume * 100)}%</span>
                     </div>
                )}
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* None Option */}
                <button 
                    onClick={() => { setSelectedMusicIndex(-1); stopPreview(); }}
                    className={`p-4 rounded-2xl border text-left transition-all h-32 flex flex-col justify-center items-center
                        ${selectedMusicIndex === -1 
                            ? 'bg-[rgba(192,174,102,0.1)] border-[#c0ae66] shadow-md' 
                            : 'bg-white border-[rgba(0,0,0,0.05)] hover:border-[#c0ae66] text-[#717684]'
                        }`}
                >
                    <div className={`text-sm font-medium ${selectedMusicIndex === -1 ? 'text-[#c0ae66]' : ''}`}>Keine Musik</div>
                    <div className="text-[10px] opacity-70 mt-1">Nur Stimme</div>
                </button>

                <MusicSlotCard index={0} label="Musik A" />
                <MusicSlotCard index={1} label="Musik B" />
                <MusicSlotCard index={2} label="Musik C" />
            </div>
        </div>

        {/* Action Area */}
        <div className="flex justify-end pt-8">
          <button
            onClick={handleGenerateAudio}
            disabled={loading || !script}
            className="btn-primary flex items-center gap-3 px-10 py-5 rounded-full font-bold uppercase tracking-widest text-sm shadow-lg transform active:scale-95"
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
                Podcast Generieren
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-[#c0392b] text-sm text-center animate-fade-in">
            {error}
          </div>
        )}

        {audioUrl && (
          <div className="animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="bg-white rounded-2xl p-8 border border-[#c0ae66] shadow-[0_10px_30px_rgba(192,174,102,0.15)]">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-[#f9f9f9] border border-[#c0ae66] flex items-center justify-center text-[#c0ae66]">
                    <Music className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-[#181818] font-medium text-lg">Final Podcast</h3>
                    <p className="text-xs text-[#717684]">
                        320kbps MP3 • {introFile && 'Intro + '}Dialog{selectedMusicIndex !== -1 && ' + BG Music'}{outroFile && ' + Outro'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={openEmailModal}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#f9f9f9] hover:bg-[#e5e5e5] text-[#181818] rounded-full transition-colors border border-[rgba(0,0,0,0.05)] text-sm font-medium"
                    title="Send via Email"
                  >
                    <Mail className="w-4 h-4" />
                    <span className="text-sm font-medium">Email</span>
                  </button>
                  <a
                    href={audioUrl}
                    download={`AI-Podcast_${new Date().toISOString().slice(0,10)}.mp3`}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#181818] hover:bg-[#333] text-white rounded-full transition-colors shadow-md"
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
                className="w-full h-12 accent-[#c0ae66] opacity-90 hover:opacity-100 transition-opacity"
                style={{ borderRadius: '8px' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* EMAIL MODAL */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[rgba(24,24,24,0.6)] backdrop-blur-sm transition-opacity" onClick={() => setShowEmailModal(false)} />
          <div className="relative bg-white border border-[rgba(0,0,0,0.05)] rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-[rgba(0,0,0,0.05)]">
               <h3 className="text-lg font-medium text-[#181818] flex items-center gap-2">
                 <Mail className="w-5 h-5 text-[#c0ae66]" /> Podcast versenden
               </h3>
               <button onClick={() => setShowEmailModal(false)} className="text-[#717684] hover:text-[#181818] transition-colors">
                 <X className="w-5 h-5" />
               </button>
            </div>

            {/* Body */}
            <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar bg-[#fcfcfc]">
              <div>
                <label className="block text-xs font-medium text-[#181818] uppercase tracking-wider mb-2">An (Empfänger)</label>
                <input 
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="freund@beispiel.de"
                  className="w-full rounded-xl py-3 px-4"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#181818] uppercase tracking-wider mb-2">Betreff</label>
                <input 
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full rounded-xl py-3 px-4"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#181818] uppercase tracking-wider mb-2">Nachricht</label>
                <textarea 
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={8}
                  className="w-full rounded-xl py-3 px-4 font-mono text-sm leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-4 p-4 bg-white border border-[rgba(0,0,0,0.08)] rounded-xl shadow-sm">
                <div className="w-10 h-10 bg-[#f9f9f9] rounded-full flex items-center justify-center text-[#c0ae66] border border-[#c0ae66]">
                  <FileAudio className="w-5 h-5" />
                </div>
                <div>
                   <div className="text-sm font-medium text-[#181818]">podcast_episode.mp3</div>
                   <div className="text-xs text-[#717684]">High Quality MP3 • Anhang</div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-[rgba(0,0,0,0.05)] flex justify-end gap-3 bg-white rounded-b-2xl">
               <button 
                 onClick={() => setShowEmailModal(false)}
                 className="px-6 py-2.5 text-[#717684] hover:text-[#181818] transition-colors font-medium text-sm"
               >
                 Abbrechen
               </button>
               <button 
                 onClick={handleSendEmail}
                 disabled={isSendingEmail || !emailTo.trim()}
                 className="btn-primary px-8 py-2.5 rounded-full flex items-center gap-2 font-bold uppercase tracking-widest text-xs"
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