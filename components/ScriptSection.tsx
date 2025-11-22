import React, { useState, useEffect } from 'react';
import { Loader2, Sparkles, Globe, Users, Settings, ChevronDown, ChevronUp, RotateCcw, Rss, Plus, Trash2, X, ExternalLink } from 'lucide-react';
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
  
  // Sources for display
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  const [localRssArticles, setLocalRssArticles] = useState<RssArticle[]>([]);
  
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
    setSearchSources([]); 
    setLocalRssArticles([]);
    setRssArticles([]);
    
    let rssContent = "";

    try {
      if (useRss && rssFeeds.length > 0) {
        setLoadingStatus("Lese & Analysiere RSS Feeds...");
        const { combinedContent, articles } = await fetchRssFeeds(rssFeeds);
        rssContent = combinedContent;
        setRssArticles(articles); 
        setLocalRssArticles(articles);
      }

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
      
      if (result.searchSources) {
        setSources(result.searchSources);
        setSearchSources(result.searchSources);
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
    <div className="card p-8 transition-all hover:shadow-lg">
      <div className="border-b border-[#c0ae66] pb-4 mb-6">
        <h2 className="text-xl font-medium text-[#181818] flex items-center gap-2 tracking-wide">
          <Sparkles className="w-5 h-5 text-[#c0ae66]" />
          SCHRITT 1: SKRIPT GENERIEREN
        </h2>
        <p className="text-[#717684] text-sm mt-1">
          Wähle ein Thema und die Sprecher.
        </p>
      </div>

      <div className="space-y-6">
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
           <div>
            <label className="block text-xs font-medium text-[#181818] uppercase tracking-wider mb-2 flex items-center gap-2">
              <Users className="w-3 h-3 text-[#717684]" /> Name Sprecher 1
            </label>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="z.B. Sarah"
              className="w-full rounded-xl py-3 px-4 transition-all"
            />
           </div>
           <div>
            <label className="block text-xs font-medium text-[#181818] uppercase tracking-wider mb-2 flex items-center gap-2">
               <Users className="w-3 h-3 text-[#717684]" /> Name Sprecher 2
            </label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="z.B. Tom"
              className="w-full rounded-xl py-3 px-4 transition-all"
            />
           </div>
        </div>

        {/* Input Area */}
        <div className="space-y-6">
          <div>
            <label className="block text-xs font-medium text-[#181818] uppercase tracking-wider mb-2">
              Podcast Thema
            </label>
            <div className="relative">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="z.B. Die neuesten Durchbrüche im Quantencomputing"
                className="w-full rounded-xl py-3 px-4 transition-all"
              />
            </div>
          </div>

          {/* Options: Search, RSS, Settings */}
          <div className="flex flex-col gap-6">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {/* Google Search Toggle */}
              <label className="flex items-center cursor-pointer gap-3 p-4 rounded-2xl border border-transparent bg-[#f9f9f9] hover:bg-[#f0f0f0] transition-colors hover:shadow-md border-dashed hover:border-[#c0ae66]">
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${useSearch ? 'bg-[#c0ae66] border-[#c0ae66]' : 'border-[#d1d5db] bg-white'}`}>
                  {useSearch && <Globe className="w-3 h-3 text-white" />}
                </div>
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={useSearch} 
                  onChange={(e) => setUseSearch(e.target.checked)} 
                />
                <div>
                  <span className="text-sm font-medium text-[#181818] block">Google Search Grounding</span>
                  <span className="text-xs text-[#717684]">Echtzeit-Web-Infos nutzen</span>
                </div>
              </label>

              {/* RSS Toggle */}
              <label className="flex items-center cursor-pointer gap-3 p-4 rounded-2xl border border-transparent bg-[#f9f9f9] hover:bg-[#f0f0f0] transition-colors hover:shadow-md border-dashed hover:border-[#c0ae66]">
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${useRss ? 'bg-[#c0ae66] border-[#c0ae66]' : 'border-[#d1d5db] bg-white'}`}>
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
                  <span className="text-sm font-medium text-[#181818] block">RSS Feeds einbinden</span>
                  <span className="text-xs text-[#717684]">Deep Dive in Feed-Inhalte</span>
                </div>
              </label>
            </div>

            {/* RSS Management UI */}
            {useRss && showRssInput && (
              <div className="bg-white border border-[rgba(0,0,0,0.08)] rounded-2xl p-6 shadow-sm space-y-4">
                <label className="block text-xs font-semibold text-[#c0ae66] uppercase tracking-wider border-b border-[#c0ae66] pb-2 mb-2">
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
                    className="flex-1 rounded-full px-4 py-2 text-sm"
                  />
                  <button
                    onClick={handleAddRssFeed}
                    className="btn-primary w-10 h-10 rounded-full flex items-center justify-center"
                    title="Feed hinzufügen"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {/* Feed List */}
                {rssFeeds.length > 0 ? (
                  <ul className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                    {rssFeeds.map((url, idx) => (
                      <li key={idx} className="group flex items-center justify-between bg-[#f9f9f9] border border-[rgba(0,0,0,0.05)] rounded-xl px-4 py-3 text-sm hover:border-[#c0ae66] transition-colors">
                        <span className="text-[#333] truncate mr-2 font-medium" title={url}>{url}</span>
                        <button
                          onClick={() => handleRemoveRssFeed(idx)}
                          className="text-[#717684] hover:text-[#c0392b] transition-colors"
                          title="Feed entfernen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                   <div className="text-center py-4 text-[#717684] text-sm italic border border-dashed border-[rgba(0,0,0,0.1)] rounded-xl">Noch keine Feeds. Füge oben eine URL hinzu.</div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 text-xs text-[#717684] hover:text-[#181818] transition-colors bg-[#f9f9f9] px-3 py-1.5 rounded-full border border-[rgba(0,0,0,0.05)]"
              >
                <Settings className="w-3 h-3" />
                {showSettings ? 'Erweiterte Einstellungen verbergen' : 'Erweiterte Einstellungen'}
                {showSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>

            {/* Collapsible Advanced Settings */}
            {showSettings && (
              <div className="bg-[#f9f9f9] border border-[rgba(0,0,0,0.05)] rounded-2xl p-6 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between mb-4">
                  <label className="block text-xs font-semibold text-[#333] uppercase tracking-wider">
                    System Prompt (KI-Anweisungen)
                  </label>
                  <button 
                    onClick={handleResetInstruction}
                    className="text-xs text-[#c0ae66] hover:text-[#a08e46] flex items-center gap-1 font-medium"
                  >
                    <RotateCcw className="w-3 h-3" /> Zurücksetzen
                  </button>
                </div>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  rows={6}
                  className="w-full rounded-xl p-3 text-xs text-[#333] font-mono leading-relaxed"
                  placeholder="Anweisungen für das Modell..."
                />
                <p className="text-[10px] text-[#717684] mt-2">
                  Tipp: Hier kannst du die Persönlichkeit, den Ton oder die Formatierung anpassen. Sprechernamen und Thema werden automatisch angehängt.
                </p>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={loading || !topic.trim() || !hostName.trim() || !guestName.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2 px-8 py-4 rounded-full font-bold uppercase tracking-widest text-sm"
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
          <div className="animate-fade-in pt-8 border-t border-[rgba(0,0,0,0.05)]">
            <div className="flex items-center justify-between mb-4">
              <label className="block text-xs font-medium text-[#181818] uppercase tracking-wider">
                Skript Editor
              </label>
              <span className="text-xs text-[#717684] bg-[#f9f9f9] px-2 py-1 rounded-md border border-[rgba(0,0,0,0.05)]">Bearbeitbar</span>
            </div>
            <textarea
              value={currentScript}
              onChange={handleScriptChange}
              rows={12}
              className="w-full bg-white border border-[rgba(0,0,0,0.08)] rounded-2xl p-6 text-[#333] font-mono text-sm leading-relaxed shadow-inner"
            />
            
            {/* RSS Sources Display */}
            {localRssArticles.length > 0 && (
              <div className="mt-6 bg-[#f9f9f9] p-6 rounded-2xl border border-[rgba(0,0,0,0.05)]">
                <h4 className="text-xs font-semibold text-[#c0ae66] uppercase tracking-wider mb-4 border-b border-[#c0ae66] pb-2 inline-block">
                  Verwendete RSS-Quellen
                </h4>
                <ul className="space-y-3">
                  {localRssArticles.map((article, idx) => (
                    <li key={idx} className="flex flex-col gap-1 text-sm">
                      <div className="flex items-start gap-2 font-medium text-[#181818]">
                        <Rss className="w-4 h-4 text-[#c0ae66] mt-0.5 shrink-0" />
                        {article.title}
                      </div>
                      <div className="flex items-center gap-2 pl-6 text-xs text-[#717684]">
                         <span className="uppercase tracking-wide font-semibold">{article.source}</span>
                         <span className="text-gray-300">•</span>
                         <a 
                            href={article.link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[#c0ae66] hover:underline hover:text-[#a08e46] transition-colors"
                         >
                           Artikel öffnen <ExternalLink className="w-3 h-3" />
                         </a>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Google Search Sources Display */}
            {sources.length > 0 && (
              <div className="mt-6 bg-[#f9f9f9] p-6 rounded-2xl border border-[rgba(0,0,0,0.05)]">
                <h4 className="text-xs font-semibold text-[#c0ae66] uppercase tracking-wider mb-4 border-b border-[#c0ae66] pb-2 inline-block">Verwendete Quellen (Google Search)</h4>
                <ul className="space-y-2">
                  {sources.map((source, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Globe className="w-4 h-4 text-[#c0ae66] mt-0.5 shrink-0" />
                      <a 
                        href={source.uri} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[#333] hover:text-[#c0ae66] hover:underline truncate transition-colors"
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