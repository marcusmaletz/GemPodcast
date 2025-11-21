
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Play, Pause, Download, Loader2, Volume2, Music, Upload, Square } from 'lucide-react';
import { VoiceName, BackgroundMusicPreset } from '../types';
import { generatePodcastAudio, generateVoicePreview } from '../services/geminiService';
import { decodeBase64Audio, audioBufferToWav, audioBufferToMp3, mixAudioBuffers, generateProceduralTrack } from '../utils/audioUtils';

interface AudioSectionProps {
  script: string;
  hostName: string;
  guestName: string;
}

const AudioSection: React.FC<AudioSectionProps> = ({ script, hostName, guestName }) => {
  const [hostVoice, setHostVoice] = useState<VoiceName>(VoiceName.Kore);
  const [guestVoice, setGuestVoice] = useState<VoiceName>(VoiceName.Puck);
  
  // Music State
  const [musicPreset, setMusicPreset] = useState<BackgroundMusicPreset>('none');
  const [customMusicFile, setCustomMusicFile] = useState<File | null>(null);
  const [musicVolume, setMusicVolume] = useState<number>(0.15);
  
  // Generation State
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Preview State
  const [previewLoading, setPreviewLoading] = useState<string | null>(null); // 'host' | 'guest' | 'music-chill' etc
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clean up main audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Stop preview when component unmounts
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
      
      // Convert base64 to playable blob
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
        // Generate 5 seconds of procedural music
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        // Generate 5 seconds
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
    stopPreview(); // Stop any previews
    setLoading(true);
    setError(null);
    setAudioUrl(null);

    try {
      // 1. Get TTS Audio (Base64 PCM)
      const base64Data = await generatePodcastAudio(script, hostName, guestName, hostVoice, guestVoice);
      
      // 2. Prepare AudioContext
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // 3. Decode TTS to AudioBuffer
      const ttsBufferRaw = await decodeBase64Audio(base64Data, audioContext);
      
      // 4. Prepare Background Music Buffer
      let musicBuffer: AudioBuffer | null = null;

      if (musicPreset !== 'none') {
        if (musicPreset === 'chill' || musicPreset === 'news') {
           // Generate procedural track matching the TTS buffer length
           const duration = ttsBufferRaw.duration;
           // Use offline context to allow fast generation without blocking main thread heavily
           const tempCtx = new OfflineAudioContext(2, Math.ceil(duration * 24000), 24000);
           musicBuffer = generateProceduralTrack(musicPreset, duration, tempCtx as unknown as AudioContext);
        } 
      } else if (customMusicFile) {
        const fileBuffer = await customMusicFile.arrayBuffer();
        const offlineCtx = new OfflineAudioContext(2, 1, 24000); 
        musicBuffer = await offlineCtx.decodeAudioData(fileBuffer);
      }

      // 5. Mix
      const mixedBuffer = mixAudioBuffers(ttsBufferRaw, musicBuffer, musicVolume, audioContext);
      
      // 6. Convert to MP3 (320kbps)
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
      setMusicPreset('none'); // Deselect preset
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
        {/* Voice Selection */}
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

        {/* Music Selection */}
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

                {/* Chill Preset */}
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
                
                {/* News Preset */}
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

                {/* Custom Upload */}
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

export default AudioSection;
