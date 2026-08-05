import React, { useState } from 'react';
import { Save, CheckCircle2, AlertCircle, Loader2, Key, Database, Table, Info } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import { AirtableConfig } from '../types';
import { cn } from '../lib/utils';

export function Settings() {
  const { config, mappings, loading, saveConfig, saveMappings } = useSettings();
  const [localConfig, setLocalConfig] = useState<AirtableConfig>(config);
  const [isValidating, setIsValidating] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'none'; message: string }>({
    type: 'none',
    message: '',
  });

  // Update local config when it loads from storage
  React.useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleSaveConfig = async () => {
    setIsValidating(true);
    chrome.runtime.sendMessage({ action: 'validateConfig', config: localConfig }, async (res) => {
      setIsValidating(false);
      if (res.success) {
        await saveConfig(localConfig);
        setStatus({ type: 'success', message: 'Configuration saved and validated!' });
        setTimeout(() => setStatus({ type: 'none', message: '' }), 3000);
      } else {
        setStatus({ type: 'error', message: res.error || 'Invalid configuration' });
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-white/20" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-white/70 px-1 flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-500" />
          Airtable Configuration
        </h2>
        <div className="space-y-5 p-6 glass-card shadow-inner">
          <div className="space-y-2 group/field">
            <label className="section-label">
              <Key className="w-3 h-3 text-white/20 group-focus-within/field:text-blue-500 transition-colors" />
              Personal Access Token
            </label>
            <input
              type="password"
              value={localConfig.apiKey}
              onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
              className="input-field h-11 bg-black/40"
              placeholder="pat..."
            />
          </div>
          
          <div className="grid grid-cols-1 gap-5">
            <div className="space-y-2 group/field">
              <label className="section-label">
                <Database className="w-3 h-3 text-white/20 group-focus-within/field:text-blue-500 transition-colors" />
                Base ID
              </label>
              <input
                type="text"
                value={localConfig.baseId}
                onChange={(e) => setLocalConfig({ ...localConfig, baseId: e.target.value })}
                className="input-field h-11 bg-black/40"
                placeholder="app..."
              />
            </div>
            <div className="space-y-2 group/field">
              <label className="section-label">
                <Table className="w-3 h-3 text-white/20 group-focus-within/field:text-blue-500 transition-colors" />
                Table ID or Name
              </label>
              <input
                type="text"
                value={localConfig.tableId}
                onChange={(e) => setLocalConfig({ ...localConfig, tableId: e.target.value })}
                className="input-field h-11 bg-black/40"
                placeholder="tbl... or Table Name"
              />
            </div>
          </div>
          
          <button
            onClick={handleSaveConfig}
            disabled={isValidating || !localConfig.apiKey}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold h-11 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-blue-600/10"
          >
            {isValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save & Validate
          </button>
        </div>
      </div>

      {status.type !== 'none' && (
        <div className={cn(
          "p-4 rounded-2xl flex items-center gap-3 text-xs animate-in zoom-in-95 duration-200 border",
          status.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
        )}>
          {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {status.message}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-white/70 flex items-center gap-2">
            <Info className="w-4 h-4 text-purple-500" />
            Field Mappings
          </h2>
          <span className="text-[10px] text-white/20 uppercase tracking-widest font-bold">Profile → Column</span>
        </div>
        
        <div className="glass-card divide-y divide-white/[0.04] overflow-hidden">
          {mappings.map((mapping, idx) => (
            <div key={mapping.profileField} className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors group">
              <span className="text-xs font-bold text-white/40 capitalize group-hover:text-white/60 transition-colors">
                {mapping.profileField.replace(/([A-Z])/g, ' $1').trim()}
              </span>
              <input
                type="text"
                value={mapping.airtableColumn}
                onChange={(e) => {
                  const newMappings = [...mappings];
                  newMappings[idx] = { ...mapping, airtableColumn: e.target.value };
                  saveMappings(newMappings);
                }}
                className="bg-black/40 border border-white/5 rounded-xl px-3 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-500/30 transition-all placeholder:text-white/5 w-32"
                placeholder="Column Name"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
