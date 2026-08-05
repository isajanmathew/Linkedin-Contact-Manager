# LinkedIn to Airtable Chrome Extension

A production-ready Chrome extension that captures LinkedIn profile data and saves it directly to Airtable for sales professionals and recruiters.

## Features

- **Automatic Profile Detection**: Opens side panel when navigating to LinkedIn profiles
- **Smart Data Extraction**: Robust scraping with multiple fallback selectors
- **Airtable Integration**: Direct saving to your Airtable base
- **Professional UI**: Clean, LinkedIn-themed interface
- **Real-time Updates**: Form updates when switching profiles
- **Secure Storage**: Encrypted credential storage
- **Comprehensive Validation**: Form validation with inline feedback

## Installation

1. **Download the Extension**
   - Clone or download this repository
   - Ensure all files are in the `linkedin-airtable-extension/` directory

2. **Create Extension Icons**
   - Add icon files to the `icons/` directory:
     - `icon16.png` (16x16 pixels)
     - `icon48.png` (48x48 pixels) 
     - `icon128.png` (128x128 pixels)
   - Use a blue LinkedIn-style icon for consistency

3. **Load in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the extension directory
   - The extension will be loaded and ready to use

## Setup

1. **Airtable Configuration**
   - Create an Airtable base for your contacts
   - Get your API token from [Airtable Tokens](https://airtable.com/create/tokens)
   - Find your Base ID and Table ID from the Airtable API documentation
   - Configure these in the extension's settings panel

2. **Recommended Airtable Table Structure**
   ```
   Fields:
   - Name (Single line text)
   - Job Title (Single line text)
   - Company (Single line text)
   - Location (Single line text)
   - Bio (Long text)
   - Email (Email)
   - Phone (Phone number)
   - LinkedIn URL (URL)
   - Profile Picture (URL)
   - Tags (Single line text)
   - Notes (Long text)
   - Date Added (Date)
   ```

## Usage

1. **Navigate to LinkedIn**: Go to any LinkedIn profile page
2. **Side Panel Opens**: The extension automatically opens the side panel
3. **Review Data**: Check the auto-populated profile information
4. **Add Details**: Fill in email, phone, tags, and notes manually
5. **Save Contact**: Click "Save Contact" to add to your Airtable base

## Troubleshooting

### Common Issues

1. **Side Panel Not Opening**
   - Ensure you're on a LinkedIn profile page (`linkedin.com/in/username`)
   - Check that the extension is enabled in Chrome
   - Try refreshing the LinkedIn page

2. **Profile Data Not Loading**
   - LinkedIn occasionally changes their layout - the extension includes multiple fallback selectors
   - Try refreshing the page or navigating away and back to the profile
   - Check the browser console for any error messages

3. **Airtable Connection Failed**
   - Verify your API token is correct and has the necessary permissions
   - Double-check your Base ID and Table ID
   - Ensure your Airtable table has the recommended field structure
   - Check your internet connection

4. **Data Not Saving**
   - Verify all required fields are filled (Full Name is required)
   - Check that your Airtable API token has write permissions
   - Ensure you haven't exceeded Airtable's rate limits

### Error Messages

- **"Invalid API token"**: Your Airtable API token is incorrect or expired
- **"Base or table not found"**: Check your Base ID and Table ID
- **"Permission denied"**: Your API token doesn't have access to the specified base/table
- **"Rate limit exceeded"**: Wait a moment before trying again

## Security

- All Airtable credentials are stored securely using Chrome's encrypted storage
- The extension only runs on LinkedIn profile pages
- All data is sanitized before storage
- HTTPS-only communication with Airtable API

## Development

### File Structure
```
linkedin-airtable-extension/
├── manifest.json          # Extension configuration
├── sidepanel.html         # Side panel UI
├── sidepanel.js          # Side panel functionality
├── content.js            # LinkedIn data extraction
├── background.js         # Service worker
├── styles.css           # Extension styling
└── icons/              # Extension icons
```

### Key Technologies
- **Manifest V3**: Latest Chrome extension standard
- **Service Worker**: Background script functionality
- **Content Scripts**: DOM manipulation and data extraction
- **Side Panel API**: Persistent side panel interface
- **Chrome Storage API**: Secure credential storage

## License

This extension is provided as-is for sales professionals and recruiters. Modify and distribute according to your needs.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Verify your Airtable configuration
3. Check the browser console for error messages
4. Ensure you're using the latest version of Chrome