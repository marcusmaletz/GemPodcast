import React, { useState, useEffect } from 'react';
import ScriptSection from './components/ScriptSection.tsx';
import AudioSection from './components/AudioSection.tsx';
import { RssArticle } from './types.ts';

const App: React.FC = () => {
  // Persist script
  const [script, setScript] = useState(() => localStorage.getItem('podcastScript') || '');
  
  // Lifted state for Topic to share with Email function
  const [topic, setTopic] = useState(() => localStorage.getItem('podcastTopic') || '');

  // Initialize names from localStorage or default
  const [hostName, setHostName] = useState(() => localStorage.getItem('hostName') || 'Host');
  const [guestName, setGuestName] = useState(() => localStorage.getItem('guestName') || 'Guest');
  
  // Store RSS Articles and Search Sources to pass to email
  const [rssArticles, setRssArticles] = useState<RssArticle[]>(() => {
    const saved = localStorage.getItem('rssArticles');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [searchSources, setSearchSources] = useState<{ title: string; uri: string }[]>(() => {
    const saved = localStorage.getItem('searchSources');
    return saved ? JSON.parse(saved) : [];
  });

  // Persist names when changed
  useEffect(() => {
    localStorage.setItem('hostName', hostName);
  }, [hostName]);

  useEffect(() => {
    localStorage.setItem('guestName', guestName);
  }, [guestName]);

  // Persist Topic when changed
  useEffect(() => {
    localStorage.setItem('podcastTopic', topic);
  }, [topic]);
  
  // Persist Script
  useEffect(() => {
    localStorage.setItem('podcastScript', script);
  }, [script]);

  // Persist Sources
  useEffect(() => {
    localStorage.setItem('rssArticles', JSON.stringify(rssArticles));
  }, [rssArticles]);

  useEffect(() => {
    localStorage.setItem('searchSources', JSON.stringify(searchSources));
  }, [searchSources]);

  const handleScriptReady = (newScript: string) => {
    setScript(newScript);
  };

  return (
    <div className="container mx-auto max-w-[1200px] bg-white rounded-[16px] min-h-[calc(100vh-48px)] overflow-hidden shadow-sm border border-[rgba(0,0,0,0.05)]">
      
      {/* Header Section matching Reference */}
      <div className="relative bg-white px-10 py-16 text-center border-b-2 border-[#c0ae66] rounded-t-[16px] overflow-hidden">
        {/* SVG Pattern Background */}
        <div className="absolute inset-0 z-0 opacity-30" 
             style={{
               backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 200"><path d="M0,50 Q300,100 600,50 T1200,50 L1200,0 L0,0 Z" fill="rgba(240,240,240,1)"/></svg>')`,
               backgroundRepeat: 'no-repeat',
               backgroundSize: 'cover'
             }} 
        />
        
        <a href="#" className="absolute top-5 right-8 bg-[#f9f9f9] border border-[rgba(0,0,0,0.05)] text-[#181818] px-4 py-2 rounded-full text-sm font-medium hover:bg-[#e5e5e5] transition-all z-10 no-underline">
          ← ANY EVER Studio
        </a>

        <div className="relative z-10 flex flex-col items-center justify-center">
           <div className="mb-5 flex flex-col items-center">
             <img 
               src="https://anyever.de/wp-content/themes/anyever/static/images/logo-anyever-gold.svg" 
               alt="Any Ever Logo" 
               className="w-[200px] h-auto mb-2 opacity-95" 
             />
             <div className="text-sm font-medium tracking-[0.05em] text-[#181818] uppercase mt-1">
               ENJOY.AUDIO
             </div>
           </div>
           
           <h1 className="text-[2.5rem] font-[100] tracking-[4px] text-[#181818] mb-4">
             Podcast Generator
           </h1>
           <p className="text-[#717684] text-[1.1rem]">
             Was nur dich bewegt, an einem Ort.
           </p>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr] gap-8 p-8 lg:p-12 bg-[#f9f9f9]">
        <div className="flex flex-col gap-8">
          <ScriptSection 
            onScriptReady={handleScriptReady} 
            hostName={hostName}
            setHostName={setHostName}
            guestName={guestName}
            setGuestName={setGuestName}
            topic={topic}
            setTopic={setTopic}
            setRssArticles={setRssArticles}
            setSearchSources={setSearchSources}
          />
          
          <AudioSection 
            script={script} 
            hostName={hostName}
            guestName={guestName}
            topic={topic}
            rssArticles={rssArticles}
            searchSources={searchSources}
          />
        </div>
      </div>

      <div className="text-center py-8 text-[#717684] text-xs bg-white border-t border-[rgba(0,0,0,0.05)]">
         Powered by Gemini 2.5 Flash & Flash-TTS • ANY EVER Audio Engine
      </div>
    </div>
  );
};

export default App;