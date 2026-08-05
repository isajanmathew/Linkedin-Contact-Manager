import { useState, useEffect } from 'react';
import { AirtableConfig, FieldMapping, DEFAULT_MAPPINGS } from '../types';
import { storage } from '../lib/storage';

export function useSettings() {
  const [config, setConfig] = useState<AirtableConfig>({ apiKey: '', baseId: '', tableId: '' });
  const [mappings, setMappings] = useState<FieldMapping[]>(DEFAULT_MAPPINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [storedConfig, storedMappings] = await Promise.all([
        storage.getAirtableConfig(),
        storage.getFieldMappings()
      ]);
      setConfig(storedConfig);
      setMappings(storedMappings);
      setLoading(false);
    }
    load();
  }, []);

  const saveConfig = async (newConfig: AirtableConfig) => {
    await storage.setAirtableConfig(newConfig);
    setConfig(newConfig);
  };

  const saveMappings = async (newMappings: FieldMapping[]) => {
    await storage.setFieldMappings(newMappings);
    setMappings(newMappings);
  };

  return { config, mappings, loading, saveConfig, saveMappings };
}
