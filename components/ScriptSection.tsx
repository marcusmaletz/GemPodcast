
import React, { useState, useEffect } from 'react';
import { Loader2, Sparkles, Globe, Users, Settings, ChevronDown, ChevronUp, RotateCcw, Rss, Plus, Trash2, X } from 'lucide-react';
import { generateScript } from '../services/geminiService.ts';
import { GeneratedScriptResponse, RssArticle } from '../types.ts';
import { fetchRssFeeds } from '../utils/rssUtils.ts';

interface ScriptSectionProps {
  onScriptReady: (script: string) => void;
  hostName: string;
  setHostName: (name: string) => void;
  guestName: string;
  setGuestName: (name: string) => void;
  topic: string;
  setTopic: (topic: string) => void;
  setRssArticles: (articles: RssArticle[]) => void;
  setSearchSources: (sources: { title: string; uri: string }[]) => void;
}

const DEFAULT_SYSTEM_INSTRUCTION = `Du bist ein professioneller, investigativer Podcast-Produzent.
Deine Aufgabe ist es, einen tiefgründigen, spannenden Podcast-Dialog basierend auf dem Thema und den bereitgestellten Quellen zu schreiben.

WICHTIGE REGELN FÜR DEN INHALT:
1. **SPRACHE**: Der gesamte Dialog muss zwingend auf DEUTSCH verfasst sein.
2. **KEIN OBERFLÄCHLICHER SMALLTALK**: Liste nicht nur Schlagzeilen auf. Analysiere die AUSWIRKUNGEN und HINTERGRÜNDE der Nachrichten.
3. **QUELLEN NENNEN**: Wenn Fakten aus den RSS-Feeds besprochen werden, MUSS der Name der Quelle im Dialog genannt werden (z.B. "Laut Heise Online...", "Wie The Verge berichtet hat..."). Das ist Pflicht.
4. **DISKUSSION**: Der Host und der Gast sollten leicht unterschiedliche Perspektiven haben oder kritische Nachfragen stellen.
5. **NATÜRLICHKEIT**: Es soll wie ein echtes Gespräch klingen, nicht wie vorgelesen.

Formatierung:
1. Das Skript muss ein Dialog sein.
2. Nutze exakt die vorgegebenen Sprechernamen als Präfix (z.B. "Sarah:", "Tom:").
3. Länge: ca. 300-500 Wörter (ausreichend für Tiefe).
4. Starte sofort mit dem Dialog.`;

const ScriptSection: React.FC<ScriptSectionProps> = ({ 
  onScriptReady, 
  hostName, 
  setHostName, 
  guestName, 
  setGuestName,
  topic,
  setTopic,
  setRssArticles,
  setSearchSources
}) => {
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");

  // Initialize prefs from localStorage
  const [useSearch, setUseSearch] = useState(() => localStorage.getItem('useSearch') === 'true');
  
  // RSS State
  const [useRss, setUseRss] = useState(() => localStorage.getItem('useRss') === 'true');
  const [showRssInput, setShowRssInput] = useState(false);
  
  // Manage RSS Feeds as a list
  const [rssFeeds, setRssFeeds] = useState<string[]>(() => {
    const savedList = localStorage.getItem('rssFeedsList');
    if (savedList) {
      try {
        return JSON.parse(savedList);
      } catch (e) {
        console.error("Error parsing RSS list", e);
      }
    }
    const oldString = localStorage.getItem('rssUrls');
    if (oldString) {
      return oldString.split('\n').filter(u => u.trim().length > 0);
    }
    return [];
  });
  const [newRssInput, setNewRssInput] = useState('');

  const [currentScript, setCurrentScript] = useState('');
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  
  // Advanced Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [systemInstruction, setSystemInstruction] = useState(() => localStorage.getItem('systemInstruction') || DEFAULT_SYSTEM_INSTRUCTION);

  // Persistence
  useEffect(() => {
    localStorage.setItem('useSearch', useSearch.toString());
  }, [useSearch]);

  useEffect(() => {
    localStorage.setItem('useRss', useRss.toString());
    if (useRss) setShowRssInput(true);
  }, [useRss]);

  useEffect(() => {
    localStorage.setItem('rssFeedsList', JSON.stringify(rssFeeds));
  }, [rssFeeds]);

  useEffect(() => {
    localStorage.setItem('systemInstruction', systemInstruction);
  }, [systemInstruction]);

  const handleAddRssFeed = () => {
    if (newRssInput.trim()) {
      if (!rssFeeds.includes(newRssInput.trim())) {
        setRssFeeds([...rssFeeds, newRssInput.trim()]);
      }
      setNewRssInput('');
    }
  };

  const handleRemoveRssFeed = (index: number) => {
    const newFeeds = [...rssFeeds];
    newFeeds.splice(index, 1);
    setRssFeeds(newFeeds);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddRssFeed();
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim() || !hostName.trim() || !guestName.trim()) return;
    
    setLoading(true);
    setSources([]);
    setSearchSources([]); // Clear previous search sources in parent
    let rssContent = "";

    try {
      // 1. Fetch RSS if enabled
      if (useRss && rssFeeds.length > 0) {
        setLoadingStatus("Lese & Analysiere RSS Feeds...");
        const { combinedContent, articles } = await fetchRssFeeds(rssFeeds);
        rssContent = combinedContent;
        setRssArticles(articles); // Pass structured articles to App -> AudioSection for email
      } else {
        setRssArticles([]);
      }

      // 2. Generate Script
      setLoadingStatus("Schreibe Deep Dive Skript...");
      const result: GeneratedScriptResponse = await generateScript(
        topic, 
        hostName, 
        guestName, 
        useSearch,
        rssContent,
        systemInstruction
      );
      setCurrentScript(result.script);
      
      // Handle search sources
      if (result.searchSources) {
        setSources(result.searchSources);
        setSearchSources(result.searchSources); // Pass to parent
      }
      
      onScriptReady(result.script);
    } catch (error) {
      console.error(error);
      alert("Fehler beim Generieren des Skripts.");
    } finally {
      setLoading(false);
      setLoadingStatus("");
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
          Schritt 1: Skript Generieren
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Wähle ein Thema und die Sprecher.
        </p>
      </div>

      <div className="p-6 space-y-6">
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" /> Name Sprecher 1
            </label>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="z.B. Sarah"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
           </div>
           <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
               <Users className="w-4 h-4 text-slate-400" /> Name Sprecher 2
            </label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="z.B. Tom"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            />
           </div>
        </div>

        {/* Input Area */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Podcast Thema
            </label>
            <div className="relative">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="z.B. Die neuesten Durchbrüche im Quantencomputing"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-3 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Options: Search, RSS, Settings */}
          <div className="flex flex-col gap-4">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {/* Google Search Toggle */}
              <label className="flex items-center cursor-pointer gap-3 p-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:bg-slate-800 transition-colors">
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useSearch ? 'bg-purple-600 border-purple-600' : 'border-slate-600'}`}>
                  {useSearch && <Globe className="w-3 h-3 text-white" />}
                </div>
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={useSearch} 
                  onChange={(e) => setUseSearch(e.target.checked)} 
                />
                <div>
                  <span className="text-sm font-medium text-slate-200 block">Google Search Grounding</span>
                  <span className="text-xs text-slate-500">Echtzeit-Web-Infos nutzen</span>
                </div>
              </label>

              {/* RSS Toggle */}
              <label className="flex items-center cursor-pointer gap-3 p-3 rounded-lg border border-slate-700 bg-slate-900/50 hover:bg-slate-800 transition-colors">
                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useRss ? 'bg-orange-500 border-orange-500' : 'border-slate-600'}`}>
                  {useRss && <Rss className="w-3 h-3 text-white" />}
                </div>
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={useRss} 
                  onChange={(e) => {
                    setUseRss(e.target.checked);
                    if(e.target.checked) setShowRssInput(true);
                  }} 
                />
                <div>
                  <span className="text-sm font-medium text-slate-200 block">RSS Feeds einbinden</span>
                  <span className="text-xs text-slate-500">Deep Dive in Feed-Inhalte</span>
                </div>
              </label>
            </div>

            {/* RSS Management UI */}
            {useRss && showRssInput && (
              <div className="bg-slate-900/50 border border-orange-500/30 rounded-lg p-4 animate-in fade-in slide-in-from-top-2 space-y-3">
                <label className="block text-xs font-semibold text-orange-400 uppercase tracking-wider">
                  RSS Feeds verwalten
                </label>
                
                {/* Add Feed Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRssInput}
                    onChange={(e) => setNewRssInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="https://example.com/feed.xml"
                    className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                  />
                  <button
                    onClick={handleAddRssFeed}
                    className="bg-orange-600 hover:bg-orange-500 text-white px-3 rounded flex items-center justify-center transition-colors"
                    title="Feed hinzufügen"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Feed List */}
                {rssFeeds.length > 0 ? (
                  <ul className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                    {rssFeeds.map((url, idx) => (
                      <li key={idx} className="group flex items-center justify-between bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-xs hover:bg-slate-800 transition-colors">
                        <span className="text-slate-300 truncate mr-2 font-mono" title={url}>{url}</span>
                        <button
                          onClick={() => handleRemoveRssFeed(idx)}
                          className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Feed entfernen"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                   <div className="text-center py-2 text-slate-600 text-xs italic">Noch keine Feeds. Füge oben eine URL hinzu.</div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <Settings className="w-3 h-3" />
                {showSettings ? 'Erweiterte Einstellungen verbergen' : 'Erweiterte Einstellungen'}
                {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {/* Collapsible Advanced Settings */}
            {showSettings && (
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    System Prompt (KI-Anweisungen)
                  </label>
                  <button 
                    onClick={handleResetInstruction}
                    className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Zurücksetzen
                  </button>
                </div>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  rows={6}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-3 text-xs text-slate-300 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                  placeholder="Anweisungen für das Modell..."
                />
                <p className="text-[10px] text-slate-500 mt-2">
                  Tipp: Hier kannst du die Persönlichkeit, den Ton oder die Formatierung anpassen. Sprechernamen und Thema werden automatisch angehängt.
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
                  {loadingStatus || "Schreibe Skript..."}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Skript Generieren
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
                Skript Editor
              </label>
              <span className="text-xs text-slate-500">Bearbeitbar</span>
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
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Verwendete Quellen (Google Search)</h4>
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
