
import React, { useState, useEffect } from 'react';
import { Loader2, Search, Sparkles, Globe, Users, Settings, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { generateScript } from '../services/geminiService.ts';
import { GeneratedScriptResponse } from '../types.ts';

interface ScriptSectionProps {
  onScriptReady: (script: string) => void;
  hostName: string;
  setHostName: (name: string) => void;
  guestName: string;
  setGuestName: (name: string) => void;
  topic: string;
  setTopic: (topic: string) => void;
}

const DEFAULT_SYSTEM_INSTRUCTION = `You are a professional podcast producer.
Your task is to write a short, engaging podcast script based on the provided topic and speaker names.

Format constraints:
1. The script must be a dialogue.
2. Use the exact speaker names provided as prefixes for each line.
3. Keep it between 150-300 words total.
4. Make it sound natural, conversational, and enthusiastic.
5. Do not include sound effects or stage directions like [laughs].
6. Start immediately with the dialogue.`;

const ScriptSection: React.FC<ScriptSectionProps> = ({ 
  onScriptReady, 
  hostName, 
  setHostName, 
  guestName, 
  setGuestName,
  topic,
  setTopic
}) => {
  const [loading, setLoading] = useState(false);
  // Initialize search pref from localStorage
  const [useSearch, setUseSearch] = useState(() => localStorage.getItem('useSearch') === 'true');
  const [currentScript, setCurrentScript] = useState('');
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  
  // Advanced Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [systemInstruction, setSystemInstruction] = useState(() => localStorage.getItem('systemInstruction') || DEFAULT_SYSTEM_INSTRUCTION);

  // Persist useSearch
  useEffect(() => {
    localStorage.setItem('useSearch', useSearch.toString());
  }, [useSearch]);

  // Persist systemInstruction
  useEffect(() => {
    localStorage.setItem('systemInstruction', systemInstruction);
  }, [systemInstruction]);

  const handleGenerate = async () => {
    if (!topic.trim() || !hostName.trim() || !guestName.trim()) return;
    setLoading(true);
    setSources([]);
    try {
      const result: GeneratedScriptResponse = await generateScript(
        topic, 
        hostName, 
        guestName, 
        useSearch,
        systemInstruction
      );
      setCurrentScript(result.script);
      if (result.searchSources) {
        setSources(result.searchSources);
      }
      onScriptReady(result.script);
    } catch (error) {
      alert("Failed to generate script. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setCurrentScript(newVal);
    onScriptReady(newVal);
  };

  const handleResetInstruction = () => {
    setSystemInstruction(DEFAULT_SYSTEM_INSTRUCTION);
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

        {/* Input Area */}
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

          <div className="flex flex-col gap-4">
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
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <Settings className="w-3 h-3" />
                {showSettings ? 'Hide Advanced' : 'Advanced Settings'}
                {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {/* Collapsible Advanced Settings */}
            {showSettings && (
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    System Instruction (Prompt Engineering)
                  </label>
                  <button 
                    onClick={handleResetInstruction}
                    className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset to Default
                  </button>
                </div>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  rows={6}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-xs text-slate-300 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                  placeholder="Enter instructions for the model..."
                />
                <p className="text-[10px] text-slate-500 mt-2">
                  Tip: You can adjust the personality, tone, or formatting rules here. The host/guest names and topic will be appended automatically.
                </p>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={loading || !topic.trim() || !hostName.trim() || !guestName.trim()}
              className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium text-white transition-all transform active:scale-[0.99]
                ${loading || !topic.trim() 
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                  : 'bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-900/20'
                }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Writing Script...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Script
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Area */}
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
            
            {/* Sources Display */}
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

export default ScriptSection;
