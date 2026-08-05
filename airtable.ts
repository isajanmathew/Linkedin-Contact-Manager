import { ProfileData, AirtableConfig, FieldMapping } from '../types';

export async function saveToAirtable(
  profile: ProfileData,
  config: AirtableConfig,
  mappings: FieldMapping[]
) {
  const { apiKey, baseId, tableId } = config;
  
  if (!apiKey || !baseId || !tableId) {
    throw new Error('Airtable configuration is incomplete.');
  }

  const fields: Record<string, any> = {};
  
  mappings.forEach(mapping => {
    const value = profile[mapping.profileField];
    if (value && mapping.airtableColumn) {
      fields[mapping.airtableColumn] = value;
    }
  });

  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      records: [{ fields }]
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to save to Airtable');
  }

  return await response.json();
}

export async function validateAirtableConfig(config: AirtableConfig) {
  const { apiKey, baseId, tableId } = config;
  
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}?maxRecords=1`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Invalid Airtable configuration');
  }

  return true;
}
