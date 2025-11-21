
import React, { useState } from 'react';
import { Loader2, Search, Sparkles, Globe, Users } from 'lucide-react';
import { generateScript } from '../services/geminiService.ts';
import { GeneratedScriptResponse } from '../types.ts';

interface ScriptSectionProps {
  onScriptReady: (script: string) => void;
  hostName: string;
  setHostName: (name: string) => void;
  guestName: string;
  setGuestName: (name: string) => void;
}

const ScriptSection: React.FC<ScriptSectionProps> = ({ 
  onScriptReady, 
  hostName, 
  setHostName, 
  guestName, 
  setGuestName 
}) => {
  const [topic, setTopic] = useState('');
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
