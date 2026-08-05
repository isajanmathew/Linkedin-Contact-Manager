import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Settings as SettingsIcon, Save, CheckCircle2, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { ProfileData } from './types';
import { ContactForm } from './components/ContactForm';
import { Settings } from './components/Settings';
import { cn } from './lib/utils';

const INITIAL_PROFILE: ProfileData = {
  fullName: '',
  jobTitle: '',
  company: '',
  location: '',
  email: '',
  phone: '',
  profileUrl: '',
  profilePicture: '',
  tags: '',
  notes: '',
  connectedDate: '',
  savedAt: '',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'form' | 'settings'>('form');
  const [profile, setProfile] = useState<ProfileData>(INITIAL_PROFILE);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'none'; message: string }>({
    type: 'none',
    message: '',
  });

  const refreshProfile = useCallback(() => {
    setIsRefreshing(true);
    setStatus({ type: 'none', message: '' });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'extractProfile' }, (res) => {
          setIsRefreshing(false);
          if (res?.profile) {
            setProfile(res.profile);
            
            // Check if essential fields are missing
            if (!res.profile.fullName && !res.profile.jobTitle) {
              setStatus({ 
                type: 'error', 
                message: 'Profile data not found. Please ensure you are on a LinkedIn profile page.' 
              });
            } else {
              setStatus({ 
                type: 'success', 
                message: 'Profile information extracted successfully!' 
              });
              setTimeout(() => setStatus({ type: 'none', message: '' }), 3000);
            }
          } else if (res?.error) {
            setStatus({ type: 'error', message: res.error });
          } else {
            setStatus({ 
              type: 'error', 
              message: 'Failed to extract profile. Content script might not be loaded yet.' 
            });
          }
        });
      } else {
        setIsRefreshing(false);
        setStatus({ type: 'error', message: 'No active tab found.' });
      }
    });
  }, []);

  useEffect(() => {
    // 1. Listen for profile updates from content script
    const listener = (msg: any) => {
      if (msg.type === 'PROFILE_UPDATED' && msg.profile) {
        setProfile(msg.profile);
        if (msg.profile.fullName || msg.profile.jobTitle) {
          setStatus({ type: 'success', message: 'Profile updated!' });
          setTimeout(() => setStatus({ type: 'none', message: '' }), 3000);
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    
    // 2. Initial load from background state
    chrome.runtime.sendMessage({ action: 'getLastProfile' }, (res) => {
      if (res?.profile) {
        setProfile(res.profile);
      } else {
        // Only trigger initial extraction if background doesn't have a profile yet
        refreshProfile();
      }
    });
    
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshProfile]);

  const handleSave = () => {
    setIsSaving(true);
    setStatus({ type: 'none', message: '' });
    chrome.runtime.sendMessage({ action: 'saveToAirtable', profile }, (res) => {
      setIsSaving(false);
      if (res.success) {
        setStatus({ type: 'success', message: 'Contact saved to Airtable!' });
        setTimeout(() => setStatus({ type: 'none', message: '' }), 5000);
      } else {
        setStatus({ type: 'error', message: res.error || 'Failed to save contact' });
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-white font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-black/20 backdrop-blur-xl sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
            <UserPlus className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">Contact Saver</h1>
            <p className="text-[10px] text-white/30 font-medium uppercase tracking-wider">Airtable Integration</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {activeTab === 'form' && (
            <button
              onClick={refreshProfile}
              disabled={isRefreshing}
              className="p-2 rounded-xl text-white/30 hover:text-white hover:bg-white/5 transition-all"
              title="Refresh profile data"
            >
              <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
            </button>
          )}
          <div className="flex gap-1 bg-white/[0.04] p-1 rounded-2xl border border-white/[0.06]">
            <button
              onClick={() => setActiveTab('form')}
              className={cn(
                "p-2 rounded-xl transition-all duration-200",
                activeTab === 'form' ? "bg-white/10 text-white shadow-sm" : "text-white/30 hover:text-white"
              )}
            >
              <UserPlus className="w-4 h-4" />
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={cn(
                "p-2 rounded-xl transition-all duration-200",
                activeTab === 'settings' ? "bg-white/10 text-white shadow-sm" : "text-white/30 hover:text-white"
              )}
            >
              <SettingsIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
        {activeTab === 'form' ? (
          <ContactForm profile={profile} setProfile={setProfile} />
        ) : (
          <Settings />
        )}
      </main>

      {/* Footer / Action */}
      <footer className="p-6 border-t border-white/[0.06] bg-black/40 backdrop-blur-xl space-y-4">
        {status.type !== 'none' && (
          <div className={cn(
            "p-4 rounded-2xl flex items-center gap-3 text-sm animate-in zoom-in-95 duration-300 border shadow-2xl shadow-black/50",
            status.type === 'success' ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
          )}>
            <div className={cn(
              "p-1.5 rounded-lg shrink-0",
              status.type === 'success' ? "bg-green-500/20" : "bg-red-500/20"
            )}>
              {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            </div>
            <span className="font-medium leading-tight">{status.message}</span>
          </div>
        )}
        
        {activeTab === 'form' && (
          <button
            onClick={handleSave}
            disabled={!profile.fullName || isSaving}
            className="w-full h-14 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-bold rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-xl shadow-blue-600/20 disabled:shadow-none"
          >
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            Save to Airtable
          </button>
        )}
        <p className="text-[10px] text-center text-white/20 font-medium tracking-widest uppercase">
          v1.1.0 • Built with Blink
        </p>
      </footer>
    </div>
  );
}
