import { ExternalLink, User, Briefcase, MapPin, Mail, Phone, Link as LinkIcon, Tag, StickyNote, Globe } from 'lucide-react';
import { ProfileData } from '../types';
import { cn } from '../lib/utils';

interface ContactFormProps {
  profile: ProfileData;
  setProfile: (profile: ProfileData) => void;
}

type FieldDef = {
  key: keyof ProfileData;
  label: string;
  icon: typeof User;
  placeholder?: string;
  readOnly?: boolean;
  isTextarea?: boolean;
};

export function ContactForm({ profile, setProfile }: ContactFormProps) {
  const fields: FieldDef[] = [
    { key: 'fullName', label: 'Full Name', icon: User, placeholder: 'John Doe' },
    { key: 'jobTitle', label: 'Job Title', icon: Briefcase, placeholder: 'Software Engineer' },
    { key: 'company', label: 'Company', icon: Globe, placeholder: 'Acme Inc.' },
    { key: 'location', label: 'Location', icon: MapPin, placeholder: 'San Francisco, CA' },
    { key: 'email', label: 'Email', icon: Mail, placeholder: 'john@example.com' },
    { key: 'phone', label: 'Phone', icon: Phone, placeholder: '+1 (555) 000-0000' },
    { key: 'profileUrl', label: 'LinkedIn URL', icon: LinkIcon, readOnly: true },
    { key: 'tags', label: 'Tags', icon: Tag, placeholder: 'Prospect, Design' },
    { key: 'notes', label: 'Notes', icon: StickyNote, isTextarea: true, placeholder: 'Met at coffee shop...' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Profile Card Summary */}
      <div className="relative group">
        <div className="absolute -inset-px bg-gradient-to-r from-blue-600/20 to-purple-600/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="relative glass-card p-6 flex items-center gap-5">
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
            {profile.profilePicture ? (
              <img 
                src={profile.profilePicture} 
                alt={profile.fullName} 
                className="relative w-16 h-16 rounded-2xl object-cover border border-white/10 shadow-lg"
              />
            ) : (
              <div className="relative w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-lg">
                <User className="w-8 h-8 text-white/10" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-white truncate">{profile.fullName || 'No Name Detected'}</h3>
            <p className="text-xs text-white/40 truncate font-medium">{profile.jobTitle || 'No Title Detected'}</p>
            {profile.company && (
              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mt-1">{profile.company}</p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5 group/field">
            <label className="section-label">
              <field.icon className="w-3 h-3 text-white/20 group-focus-within/field:text-blue-500 transition-colors" />
              {field.label}
            </label>
            {field.isTextarea ? (
              <textarea
                value={profile[field.key as keyof ProfileData]}
                onChange={(e) => setProfile({ ...profile, [field.key]: e.target.value })}
                className="input-field min-h-[120px] resize-none py-4"
                placeholder={field.placeholder}
              />
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={profile[field.key as keyof ProfileData]}
                  onChange={(e) => setProfile({ ...profile, [field.key]: e.target.value })}
                  readOnly={field.readOnly}
                  className={cn(
                    "input-field h-12",
                    field.readOnly && "text-white/30 bg-white/[0.02] cursor-default pr-10"
                  )}
                  placeholder={field.placeholder}
                />
                {field.key === 'profileUrl' && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center">
                    <ExternalLink className="w-3.5 h-3.5 text-white/10" />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
