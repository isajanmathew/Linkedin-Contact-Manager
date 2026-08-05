import { AirtableConfig, FieldMapping, DEFAULT_MAPPINGS } from '../types';

export const storage = {
  async getAirtableConfig(): Promise<AirtableConfig> {
    const data = await chrome.storage.sync.get('airtableConfig');
    return data.airtableConfig || { apiKey: '', baseId: '', tableId: '' };
  },

  async setAirtableConfig(config: AirtableConfig): Promise<void> {
    await chrome.storage.sync.set({ airtableConfig: config });
  },

  async getFieldMappings(): Promise<FieldMapping[]> {
    const data = await chrome.storage.sync.get('fieldMappings');
    return data.fieldMappings || DEFAULT_MAPPINGS;
  },

  async setFieldMappings(mappings: FieldMapping[]): Promise<void> {
    await chrome.storage.sync.set({ fieldMappings: mappings });
  }
};
