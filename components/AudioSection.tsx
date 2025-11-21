
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Play, Pause, Download, Loader2, Volume2, Music, Upload, Square, Trash2, Disc } from 'lucide-react';
import { VoiceName, MusicSlotIndex, StoredAudioFile } from '../types.ts';
import { generatePodcastAudio, generateVoicePreview } from '../services/geminiService.ts';
import { 
  decodeBase64Audio, 
  decodeAudioBlob,
  audioBufferToWav, 
  audioBufferToMp3, 
  mixPodcastSequence,
  storeAudioFile,
  getAudioFile
} from '../utils/audioUtils.ts';

interface AudioSectionProps {
  script: string;
  hostName: string;
  guestName: string;
}

const AudioSection: React.FC<AudioSectionProps> = ({ script, hostName, guestName }) => {
  const [hostVoice, setHostVoice] = useState<VoiceName>(VoiceName.Kore);
  const [guestVoice, setGuestVoice] = useState<VoiceName>(VoiceName.Puck);
  
  // Files State
  const [introFile, setIntroFile] = useState<StoredAudioFile | null>(null);
  const [outroFile, setOutroFile] = useState<StoredAudioFile | null>(null);
  // Fixed slots for Music A, B, C
  const [musicSlots, setMusicSlots] = useState<(StoredAudioFile | null)[]>([null, null, null]);
  
  // Selection State
  const [selectedMusicIndex, setSelectedMusicIndex] = useState<MusicSlotIndex>(-1);
  const [musicVolume, setMusicVolume] = useState<number>(0.10); // Default 10%
  
  // Generation State
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Preview State
  const [previewLoading, setPreviewLoading] = useState<string | null>(null); 
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // --- Initialization: Load from DB ---
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

        // Restore selection
        const savedIndex = localStorage.getItem('selectedMusicIndex');
        if (savedIndex !== null) setSelectedMusicIndex(parseInt(savedIndex) as MusicSlotIndex);

        const savedVol = localStorage.getItem('musicVolume');
        if (savedVol !== null) setMusicVolume(parseFloat(savedVol));
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
        musicVolume
      );

      // 6. Encode
      const mp3Blob = audioBufferToMp3(mixedBuffer);
      const url = URL.createObjectURL(mp3Blob);
      setAudioUrl(url);
      
      await ctx.close();

    } catch (err) {
      console.error(err);
      setError("Failed to generate audio. Please try again.");
    } finally {
      setLoading(false);
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
                
                <label className="p-1.5 text-slate-500 hover:text-purple-400 cursor-pointer">
                  <Trash2 className="w-3 h-3 hover:text-red-400" onClick={(e) => {
                    e.preventDefault();
                    // TODO: Add delete function if needed, for now just re-upload is fine
                  }}/>
                  <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'music', index)} />
                </label>
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
                     {introFile ? (
                        <button onClick={() => handlePreviewFile(introFile, 'intro')} className="text-purple-400 hover:text-white">
                           {playingPreview === 'intro' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                        </button>
                     ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                      <label className="flex-1 truncate text-xs text-slate-400 bg-slate-800 py-2 px-3 rounded cursor-pointer hover:bg-slate-700 transition-colors">
                          {introFile ? introFile.name : "Upload MP3..."}
                          <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'intro')} />
                      </label>
                  </div>
               </div>

               {/* Outro */}
               <div className={`bg-slate-900 rounded-lg p-4 border ${outroFile ? 'border-purple-500/50' : 'border-slate-700'}`}>
                  <div className="flex justify-between items-start mb-2">
                     <span className="text-sm font-medium text-white">Outro</span>
                     {outroFile ? (
                        <button onClick={() => handlePreviewFile(outroFile, 'outro')} className="text-purple-400 hover:text-white">
                           {playingPreview === 'outro' ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                        </button>
                     ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                      <label className="flex-1 truncate text-xs text-slate-400 bg-slate-800 py-2 px-3 rounded cursor-pointer hover:bg-slate-700 transition-colors">
                          {outroFile ? outroFile.name : "Upload MP3..."}
                          <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, 'outro')} />
                      </label>
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

export default AudioSection;
