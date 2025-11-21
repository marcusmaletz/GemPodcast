import React, { useState } from 'react';
import ScriptSection from './components/ScriptSection.tsx';
import AudioSection from './components/AudioSection.tsx';
import { Mic2 } from 'lucide-react';

const App: React.FC = () => {
  const [script, setScript] = useState('');
  const [hostName, setHostName] = useState('Host');
  const [guestName, setGuestName] = useState('Guest');

  const handleScriptReady = (newScript: string, newHost: string, newGuest: string) => {
    setScript(newScript);
    setHostName(newHost);
    setGuestName(newGuest);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 selection:bg-purple-500/30">
      {/* Decorative Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-indigo-900/20 rounded-full blur-[128px]" />
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-12">
        <header className="text-center mb-12 space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-900/50 mb-4">
            <Mic2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 tracking-tight">
            Gemini Podcast Studio
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Yes, it is possible! Generate a podcast script from a topic (using Google Search for real-time info) and convert it to a multi-speaker audio experience using only Gemini.
          </p>
        </header>

        <main className="space-y-8">
          <ScriptSection onScriptReady={handleScriptReady} />
          <AudioSection 
            script={script} 
            hostName={hostName}
            guestName={guestName}
          />
        </main>

        <footer className="mt-20 text-center text-slate-600 text-sm border-t border-slate-800 pt-8">
          <p>Powered by Gemini 2.5 Flash & Flash-TTS • Built with React & Tailwind</p>
        </footer>
      </div>
    </div>
  );
};

export default App;