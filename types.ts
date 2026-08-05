export interface ProfileData {
  fullName: string;
  jobTitle: string;
  company: string;
  location: string;
  email: string;
  phone: string;
  profileUrl: string;
  profilePicture: string;
  tags: string;
  notes: string;
  connectedDate: string;
  savedAt: string;
}

export interface AirtableConfig {
  apiKey: string;
  baseId: string;
  tableId: string;
}

export interface FieldMapping {
  profileField: keyof ProfileData;
  airtableColumn: string;
}

export type StorageData = {
  airtableConfig: AirtableConfig;
  fieldMappings: FieldMapping[];
};

export const DEFAULT_MAPPINGS: FieldMapping[] = [
  { profileField: 'fullName', airtableColumn: 'Name' },
  { profileField: 'jobTitle', airtableColumn: 'Job Title' },
  { profileField: 'company', airtableColumn: 'Company' },
  { profileField: 'location', airtableColumn: 'Location' },
  { profileField: 'email', airtableColumn: 'Email' },
  { profileField: 'phone', airtableColumn: 'Phone' },
  { profileField: 'profileUrl', airtableColumn: 'LinkedIn URL' },
  { profileField: 'profilePicture', airtableColumn: 'Picture' },
  { profileField: 'tags', airtableColumn: 'Tags' },
  { profileField: 'notes', airtableColumn: 'Notes' },
  { profileField: 'connectedDate', airtableColumn: 'Connected Date' },
  { profileField: 'savedAt', airtableColumn: 'Saved At' },
];
