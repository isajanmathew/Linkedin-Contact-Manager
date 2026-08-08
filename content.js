/**
 * Content script for LinkedIn profile data extraction
 * Runs on LinkedIn profile pages to extract user data
 */

// Production mode toggle - set to true for Chrome Web Store release
const IS_PRODUCTION = false;
const log = IS_PRODUCTION ? () => {} : console.log.bind(console);
const warn = IS_PRODUCTION ? () => {} : console.warn.bind(console);
const error = console.error.bind(console); // Always log errors

/**
 * Rate limiter to prevent overwhelming LinkedIn
 */
class RateLimiter {
  constructor(maxRequests = 5, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    return this.requests.length < this.maxRequests;
  }

  recordRequest() {
    this.requests.push(Date.now());
  }

  getWaitTime() {
    if (this.canMakeRequest()) return 0;
    const oldest = Math.min(...this.requests);
    return this.windowMs - (Date.now() - oldest);
  }
}

class LinkedInProfileExtractor {
  constructor() {
    this.rateLimiter = new RateLimiter(5, 60000); // 5 requests per minute (reserved for future use)
    this.profileData = {};
    this.isExtracting = false;
    this._extractionPromise = null;
    this._initialExtractionAttempts = 0;
    this.init();
  }

  /**
   * Initialize the content script
   */
  init() {
    this.setupMessageListener();
    this.injectButtonStyles();
    this._lastObservedUrl = location.href;
    this.startProfileCardObserver();
  }

  /**
   * Check if the profile card DOM elements are ready for button injection
   */
  isProfileCardReady() {
    const mainContent = document.querySelector('main');
    if (!mainContent) return false;
    const selectors = [
      '.pv-top-card-v2-ctas',
      '.artdeco-entity-lockup__badge',
      '.pv-text-details__left-panel',
      '.pvs-profile-actions',
      '.pv-top-card',
    ];
    return selectors.some(s => mainContent.querySelector(s));
  }

  /**
   * Persistent MutationObserver that watches for profile card elements
   * and injects the button as soon as the DOM is ready.
   * Handles both initial page load and SPA navigations.
   */
  startProfileCardObserver() {
    let debounceTimer = null;

    const check = () => {
      const currentUrl = location.href;

      // Handle URL change (SPA navigation)
      if (currentUrl !== this._lastObservedUrl) {
        this._lastObservedUrl = currentUrl;
        this.profileData = {};
        this.removeAddContactButton();
      }

      // Only act on profile pages
      if (!this.isLinkedInProfilePage()) {
        this.removeAddContactButton();
        return;
      }

      // Don't re-inject if already present
      if (document.getElementById('linkedin-contact-saver-corner-container') || 
          document.getElementById('linkedin-contact-saver-add-btn')) {
        return;
      }

      // Wait until profile card DOM is ready
      if (this.isProfileCardReady()) {
        this.performInitialExtraction();
        this.injectAddContactButton();
      }
    };

    const debouncedCheck = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(check, 200);
    };

    // Run an immediate check
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => debouncedCheck());
    } else {
      debouncedCheck();
    }

    // Observe DOM mutations persistently
    new MutationObserver(debouncedCheck).observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Inject CSS styles for the Add Contact button
   */
  injectButtonStyles() {
    const styleId = 'linkedin-contact-saver-button-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Blue capsule button for profile card */
      .linkedin-contact-saver-add-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        background: linear-gradient(135deg, #0066cc 0%, #0052a3 100%);
        color: white;
        border: none;
        border-radius: 16px;
        padding: 6px 14px;
        height: 28px;
        font-size: 12px;
        font-weight: 600;
        font-family: -apple-system, system-ui, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
        box-sizing: border-box;
        box-shadow: 0 1px 3px rgba(0, 102, 204, 0.3);
        margin-left: 8px;
        flex-shrink: 0;
      }
      .linkedin-contact-saver-add-btn:hover {
        background: linear-gradient(135deg, #0052a3 0%, #004080 100%);
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(0, 102, 204, 0.4);
      }
      .linkedin-contact-saver-add-btn:active {
        background: linear-gradient(135deg, #004080 0%, #003366 100%);
        transform: translateY(0);
      }
      .linkedin-contact-saver-add-btn.saved {
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        box-shadow: 0 1px 3px rgba(34, 197, 94, 0.3);
      }
      .linkedin-contact-saver-add-btn.saved:hover {
        background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
        box-shadow: 0 2px 6px rgba(34, 197, 94, 0.4);
      }
      .linkedin-contact-saver-add-btn.loading {
        opacity: 0.85;
        pointer-events: none;
      }
      .linkedin-contact-saver-add-btn svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }
      .linkedin-contact-saver-add-btn .btn-text {
        display: inline;
        white-space: nowrap;
      }
      .linkedin-contact-saver-add-btn .btn-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: linkedin-contact-saver-spin 0.8s linear infinite;
      }
      /* Floating fallback styles */
      .linkedin-contact-saver-add-btn.floating {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        height: 32px;
        padding: 8px 16px;
        border-radius: 20px;
        box-shadow: 0 4px 16px rgba(0, 102, 204, 0.35), 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .linkedin-contact-saver-add-btn.floating:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 102, 204, 0.45), 0 4px 8px rgba(0, 0, 0, 0.15);
      }
      /* Inline container near premium icon */
      .linkedin-contact-saver-inline-container {
        display: inline-flex;
        align-items: center;
        margin-left: 8px;
      }
      @keyframes linkedin-contact-saver-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Inject the Add Contact floating button onto the page
   */
  injectAddContactButton() {
    // Only inject on profile pages
    if (!this.isLinkedInProfilePage()) {
      this.removeAddContactButton();
      return;
    }

    // Remove existing button if present (for re-injection on navigation)
    this.removeAddContactButton();

    // Create button element
    const button = document.createElement('button');
    button.id = 'linkedin-contact-saver-add-btn';
    button.setAttribute('data-tooltip', 'Add Contact');
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <line x1="19" y1="8" x2="19" y2="14"/>
        <line x1="22" y1="11" x2="16" y2="11"/>
      </svg>
      <span class="btn-text">Add Contact</span>
    `;

    // Add click handler
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleAddContactClick();
    });

    // Try to inject in profile card corner (near Premium icon area)
    const injected = this.injectButtonInProfileCardCorner(button);

    if (!injected) {
      // Don't fall back to floating button — wait for the observer to retry
      // when the profile card DOM becomes ready.
      log('⏳ Profile card not ready for inline injection; observer will retry');
      return;
    }

    button.className = 'linkedin-contact-saver-add-btn';
    log('✅ Add Contact button injected in profile card corner');

    // Check if contact already saved and update button state
    this.checkIfContactSaved();
  }

  /**
   * Try to inject button inline near the Premium icon area
   * @returns {boolean} true if successfully injected, false otherwise
   */
  injectButtonInProfileCardCorner(button) {
    const mainContent = document.querySelector('main');
    if (!mainContent) {
      return false;
    }

    const makeContainer = () => {
      const container = document.createElement('div');
      container.className = 'linkedin-contact-saver-inline-container';
      container.id = 'linkedin-contact-saver-corner-container';
      container.style.display = 'inline-flex';
      container.style.alignItems = 'center';
      container.style.marginLeft = '8px';
      container.appendChild(button);
      return container;
    };

    // Strategy 1: Find action buttons row by known class names
    const actionRowSelectors = [
      '.pvs-profile-actions',
      '.pv-top-card-v2-ctas',
      '.pv-top-card__ctas-container',
      '.ph5 .mt2',
      '.pv-top-card-profile-picture ~ div .mt2'
    ];
    for (const sel of actionRowSelectors) {
      const row = mainContent.querySelector(sel);
      if (row && row.querySelector('button') && !row.querySelector('#linkedin-contact-saver-corner-container')) {
        row.appendChild(makeContainer());
        log('✅ Injected button in action row: ' + sel);
        return true;
      }
    }

    // Strategy 2: Find buttons with known text/aria-labels and inject next to their parent container
    const allButtons = mainContent.querySelectorAll('button');
    for (const btn of allButtons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      const isActionBtn = ['message', 'connect', 'follow', 'following', 'more actions', 'pending'].some(
        t => text.includes(t) || ariaLabel.includes(t)
      );
      if (!isActionBtn) continue;

      // Walk up to find the row container (a div that contains multiple buttons)
      let parentRow = btn.parentElement;
      for (let i = 0; i < 5 && parentRow; i++) {
        const buttonCount = parentRow.querySelectorAll('button').length;
        if (buttonCount >= 2) break;
        parentRow = parentRow.parentElement;
      }

      if (parentRow && !parentRow.querySelector('#linkedin-contact-saver-corner-container')) {
        parentRow.appendChild(makeContainer());
        log('✅ Injected button next to action buttons (text match)');
        return true;
      }
    }

    // Strategy 3: Find the "more actions" dropdown and insert after it
    const moreBtn = mainContent.querySelector('.artdeco-dropdown--placement-bottom, .artdeco-dropdown');
    if (moreBtn) {
      const parentRow = moreBtn.parentElement;
      if (parentRow && !parentRow.querySelector('#linkedin-contact-saver-corner-container')) {
        moreBtn.insertAdjacentElement('afterend', makeContainer());
        log('✅ Injected button after more-actions dropdown');
        return true;
      }
    }

    // Strategy 4: Inject next to the name heading
    const nameHeading = mainContent.querySelector('a > h1, h1.text-heading-xlarge, h1');
    if (nameHeading) {
      const nameRow = nameHeading.closest('.pv-text-details__left-panel, .ph5') || nameHeading.parentElement;
      if (nameRow && !nameRow.querySelector('#linkedin-contact-saver-corner-container')) {
        const container = makeContainer();
        container.style.marginLeft = '12px';
        container.style.display = 'inline-flex';
        container.style.verticalAlign = 'middle';
        nameRow.appendChild(container);
        log('✅ Injected button next to name heading');
        return true;
      }
    }

    return false;
  }

  /**
   * Remove the Add Contact button from the page
   */
  removeAddContactButton() {
    const existing = document.getElementById('linkedin-contact-saver-add-btn');
    if (existing) {
      existing.remove();
    }
    const existingContainer = document.getElementById('linkedin-contact-saver-corner-container');
    if (existingContainer) {
      existingContainer.remove();
    }
  }

  /**
   * Handle Add Contact button click
   */
  async handleAddContactClick() {
    const button = document.getElementById('linkedin-contact-saver-add-btn');
    if (!button) return;

    // Set loading state
    this.updateButtonState('loading');

    try {
      // Extract profile data if not already done
      if (!this.profileData.fullName) {
        await this.extractProfileData();
      }

      // Send message to background script to open side panel
      chrome.runtime.sendMessage({
        action: 'openSidePanelFromButton',
        profileData: this.profileData
      }, (response) => {
        // Reset to appropriate state after panel opens
        setTimeout(() => {
          this.checkIfContactSaved();
        }, 500);
      });

    } catch (err) {
      error('Failed to handle Add Contact click:', err);
      this.updateButtonState('default');
    }
  }

  /**
   * Check if current profile is already saved locally
   */
  async checkIfContactSaved() {
    const profileUrl = window.location.href;
    
    try {
      chrome.runtime.sendMessage({
        action: 'checkContactExists',
        profileUrl: profileUrl
      }, (response) => {
        if (chrome.runtime.lastError) {
          log('Could not check contact status:', chrome.runtime.lastError.message);
          this.updateButtonState('default');
          return;
        }
        
        if (response && response.exists) {
          this.updateButtonState('saved');
        } else {
          this.updateButtonState('default');
        }
      });
    } catch (err) {
      log('Error checking if contact saved:', err);
      this.updateButtonState('default');
    }
  }

  /**
   * Update the button visual state
   */
  updateButtonState(state) {
    const button = document.getElementById('linkedin-contact-saver-add-btn');
    if (!button) return;

    // Remove all state classes
    button.classList.remove('saved', 'loading');

    switch (state) {
      case 'saved':
        button.classList.add('saved');
        button.setAttribute('data-tooltip', 'Saved');
        button.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <span class="btn-text">Saved</span>
        `;
        break;
      case 'loading':
        button.classList.add('loading');
        button.setAttribute('data-tooltip', 'Opening...');
        button.innerHTML = `
          <div class="btn-spinner"></div>
          <span class="btn-text">Opening...</span>
        `;
        break;
      default:
        button.setAttribute('data-tooltip', 'Add Contact');
        button.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="19" y1="8" x2="19" y2="14"/>
            <line x1="22" y1="11" x2="16" y2="11"/>
          </svg>
          <span class="btn-text">Add Contact</span>
        `;
    }
  }

  /**
   * Setup message listener for communication with side panel
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // Sync action handled inline so it can respond synchronously
      if (request.action === 'contactSaved') {
        this.updateButtonState('saved');
        sendResponse({ success: true });
        return false;
      }
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  /**
   * Handle incoming messages from side panel
   */
  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'extractProfile':
          await this.extractProfileData();
          sendResponse({ success: true, data: this.profileData });
          break;

        case 'getProfileData':
          sendResponse({ success: true, data: this.profileData });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (err) {
      error('Content script error:', err);
      sendResponse({ success: false, error: err.message });
    }
  }

  /**
   * Perform initial profile extraction when page loads
   */
  async performInitialExtraction() {
    if (!this.isLinkedInProfilePage()) return;

    log('LinkedIn profile page detected, starting extraction...');
    await this.extractProfileData();

    // Notify side panel if it's open
    try {
      log('Sending profile data to side panel:', this.profileData);
      chrome.runtime.sendMessage({
        action: 'profileDataExtracted',
        data: this.profileData
      });
    } catch (err) {
      log('Side panel not available for initial extraction:', err);
    }

    // Retry up to 3 times (total ~9s) if data wasn't extracted
    if (!this.profileData.fullName && this._initialExtractionAttempts < 3) {
      this._initialExtractionAttempts++;
      log(`Full name not found, retry ${this._initialExtractionAttempts}/3 in 3s...`);
      setTimeout(() => this.performInitialExtraction(), 3000);
    }
  }

  /**
   * Check if current page is a LinkedIn profile page
   */
  isLinkedInProfilePage() {
    return window.location.href.includes('linkedin.com/in/');
  }

  /**
   * Extract profile data from LinkedIn page
   */
  async extractProfileData() {
    // If an extraction is already in-flight, await it instead of dropping the caller.
    if (this._extractionPromise) {
      return this._extractionPromise;
    }

    this._extractionPromise = (async () => {
      this.isExtracting = true;
      log('🚀 Starting profile data extraction...');
      log('📍 Current URL:', window.location.href);

      try {
        await this.waitForProfileContent();
        log('✅ Profile content is ready, starting field extraction...');

        await this.ensureExperienceSectionLoaded();

        // 🔬 DIAGNOSTIC DUMP — helps identify current LinkedIn DOM
        this.dumpDomDiagnostics();

        let jobTitle = this.extractJobTitle();
        let company = this.extractCompany();

        if (!jobTitle || !company) {
          log('🔁 Experience fields missing after first pass; forcing Experience section load and retrying...');
          await this.ensureExperienceSectionLoaded({ force: true });
          if (!jobTitle) jobTitle = this.extractJobTitle();
          if (!company) company = this.extractCompany();
        }

        const profileData = {
          fullName: this.extractFullName(),
          jobTitle,
          company,
          location: this.extractLocation(),
          profileUrl: window.location.href,
          profilePicture: this.extractProfilePicture()
        };

        this.profileData = this.cleanProfileData(profileData);
        log('🎉 Final profile data extracted:', this.profileData);

        try {
          chrome.runtime.sendMessage({
            action: 'profileDataExtracted',
            data: this.profileData
          });
        } catch (messageError) {
          log('❌ Failed to send message to side panel:', messageError);
        }

        return this.profileData;
      } catch (err) {
        error('❌ Profile extraction error:', err);
        try {
          chrome.runtime.sendMessage({
            action: 'profileExtractionError',
            error: err.message
          });
        } catch (_) { /* side panel might be closed */ }
        return this.profileData;
      } finally {
        this.isExtracting = false;
        this._extractionPromise = null;
      }
    })();

    return this._extractionPromise;
  }

  /**
   * Wait for profile content to be available
   */
  async waitForProfileContent() {
    const maxAttempts = 20;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const nameElement = this.findElement([
        'main h2:first-of-type',
        'main section h2:first-of-type',
        'a > h1',
        'h1[data-generated-suggestion-target]',
        'h1[data-anonymize="person-name"]',
        'h1.text-heading-xlarge',
        '.text-heading-xlarge',
        '.pv-text-details__left-panel h1',
        '.ph5 h1',
        'h1.break-words',
        'main h1'
      ]);

      if (nameElement && nameElement.textContent.trim()) {
        console.log('✅ Profile content found, proceeding with extraction');
        return;
      }

      const textName = this.extractNameFromProfileText();
      if (textName) {
        console.log('✅ Profile text found, proceeding with extraction');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    console.log('ℹ️ Profile name h1 not detected within 10s — proceeding with extraction using fallback selectors');
  }

  async ensureExperienceSectionLoaded(options = {}) {
    const force = !!options.force;
    const originalY = window.scrollY;
    const maxScrolls = force ? 12 : 8;

    for (let i = 0; i < maxScrolls; i++) {
      const section = this.getExperienceSection();
      const item = section ? this.findFirstDirectExperienceItem(section) : null;
      const itemLines = item ? this.getElementTextLines(item) : [];

      if (section && itemLines.length >= 2 && !force) break;
      if (section && itemLines.length >= 2 && force && i > 1) break;

      if (section) {
        section.scrollIntoView({ block: 'center', behavior: 'instant' });
      } else {
        window.scrollBy({ top: Math.round(window.innerHeight * 0.85), left: 0, behavior: 'instant' });
      }

      await new Promise(resolve => setTimeout(resolve, force ? 650 : 400));
    }

    window.scrollTo({ top: originalY, left: 0, behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, force ? 250 : 150));
  }

  /**
   * Extract full name from profile
   */
  extractFullName() {
    console.log('🏷️ Starting full name extraction...');
    
    const selectors = [
      // Current LinkedIn obfuscated profile layout often uses h2 for the name
      'main h2:first-of-type',
      'main section h2:first-of-type',
      // 2025 LinkedIn
      'main h1.inline.t-24',
      'main section h1.inline',
      'a > h1',
      'h1.text-heading-xlarge',
      '.text-heading-xlarge',
      '.pv-text-details__left-panel h1',
      '.ph5 h1',
      'h1[data-anonymize="person-name"]',
      'h1.break-words',
      'main h1:first-of-type',
      'main h1'
    ];

    let element = null;
    let name = '';

    for (const selector of selectors) {
      try {
        const candidate = document.querySelector(selector);
        const candidateText = this.cleanText(candidate?.textContent || '');
        if (!candidateText) continue;
        if (this.isTopCardNoiseLine(candidateText)) continue;
        if (this.isLikelyLocation(candidateText) || this.isConnectionDegreeText(candidateText)) continue;
        if (candidateText.includes('|') || candidateText.length > 80) continue;

        element = candidate;
        name = candidateText;
        break;
      } catch (e) { /* invalid selector, skip */ }
    }

    if (!name) {
      name = this.extractNameFromProfileText();
    }
    
    console.log('📝 Full name extraction result:');
    console.log(`  Raw text: "${element?.textContent}"`);
    console.log(`  Cleaned name: "${name}"`);
    
    console.log('Extracted name:', name);
    return name;
  }

  /**
   * Get visible LinkedIn profile lines from the current rendered page.
   * LinkedIn's 2026 profile DOM now uses obfuscated classes and often renders
   * the profile name as an h2 instead of an h1, so text-line parsing is the
   * most stable fallback for the top card.
   */
  getMainTextLines() {
    const root = document.querySelector('main') || document.body;
    const rawText = root?.innerText || '';
    return rawText
      .split('\n')
      .map(line => this.cleanText(line))
      .filter(Boolean);
  }

  getTopCardRoot() {
    const main = document.querySelector('main') || document.body;
    const name = this.extractNameFromProfileText();

    // If the matched ancestor also contains other profile sections
    // (Highlights, About, Featured), we've climbed too high — walk back down.
    const isTooBroad = (el) => {
      if (!el) return true;
      const text = el.innerText || '';
      return text.length > 4000 && /\bHighlights\b/.test(text) && /\bAbout\b/.test(text);
    };

    const narrowFrom = (startEl) => {
      let candidate = startEl?.closest('section, .pv-top-card, .ph5') || startEl?.parentElement;
      let depth = 0;
      while (candidate && isTooBroad(candidate) && depth < 6) {
        candidate = candidate.parentElement;
        depth++;
      }
      return candidate;
    };

    if (name) {
      const headings = Array.from(main.querySelectorAll('h1, h2'));
      const matchingHeading = headings.find(heading => this.cleanText(heading.textContent) === name);
      const narrowed = narrowFrom(matchingHeading);
      if (narrowed) return narrowed;
    }

    const selectors = [
      'a > h1',
      'h1[data-generated-suggestion-target]',
      'h1[data-anonymize="person-name"]',
      'h1.text-heading-xlarge',
      '.text-heading-xlarge',
      '.pv-text-details__left-panel h1',
      '.ph5 h1',
      'h1.break-words',
      'main h1'
    ];
    const nameElement = this.findElement(selectors);
    const narrowedFallback = narrowFrom(nameElement);
    if (narrowedFallback) return narrowedFallback;

    return main?.querySelector('section') || main;
  }

  getTopCardTextLines() {
    const root = this.getTopCardRoot();
    const rawText = root?.innerText || '';
    return rawText
      .split('\n')
      .map(line => this.cleanText(line))
      .filter(Boolean);
  }

  getProfileNameFromTitle() {
    const titleName = (document.title || '')
      .replace(/\s*\|\s*LinkedIn.*$/i, '')
      .trim();

    if (!titleName || /^LinkedIn$/i.test(titleName)) return '';
    return this.cleanText(titleName);
  }

  isTopCardNoiseLine(line) {
    const text = this.cleanText(line);
    if (!text) return true;

    const noisePatterns = [
      /^\.$/,
      /^\d+(st|nd|rd|th)$/i,
      /^[·•]\s*\d+(st|nd|rd|th)$/i,
      /^\d+\s+notifications?$/i,
      /^Skip to/i,
      /^(Home|My Network|Jobs|Messaging|Notifications|Me|For Business)$/i,
      /^Premium Page:/i,
      /^(Follow|Message|More|Connect)$/i,
      /^(Visit my website|Open to|Open profile photo)$/i,
      /^Contact info$/i,
      /^Subscribe to/i,
      /^Your personalized threads$/i,
      /^Highlights$/i,
      /^About$/i,
      /^More profiles for you$/i,
      /^\d[\d,]*\s+followers?$/i,
      /mutual connections?/i,
      /^(Open profile photo|Background Image)$/i
    ];

    return noisePatterns.some(pattern => pattern.test(text));
  }

  isPronounsLine(line) {
    const text = this.cleanText(line);
    if (!text) return false;

    const withoutDegree = text.replace(/\s*[·•]\s*\d+(st|nd|rd|th).*$/i, '').trim();
    return /^(he|him|his|she|her|hers|they|them|theirs|ze|zir|xe|xem|any)\s*\/\s*(he|him|his|she|her|hers|they|them|theirs|ze|zir|xe|xem|any)$/i.test(withoutDegree) ||
      /^(he\/him|she\/her|they\/them|he\/they|she\/they|any pronouns)$/i.test(withoutDegree);
  }

  isLikelyHeadlineLine(line) {
    const text = this.cleanText(line);
    if (!text || text.length < 2 || text.length > 220) return false;
    if (this.isTopCardNoiseLine(text) || this.isPronounsLine(text)) return false;
    if (this.isLikelyLocation(text) || this.isConnectionDegreeText(text)) return false;
    if (/^\d[\d,]*\s+(followers?|connections?)$/i.test(text)) return false;
    if (/^(Contact info|Experience|Education|Licenses|Skills)$/i.test(text)) return false;
    return true;
  }

  extractNameFromProfileText() {
    const titleName = this.getProfileNameFromTitle();
    if (titleName) return titleName;

    const lines = this.getMainTextLines();
    for (const line of lines.slice(0, 12)) {
      if (this.isTopCardNoiseLine(line)) continue;
      if (this.isLikelyLocation(line) || this.isConnectionDegreeText(line)) continue;
      if (line.includes('|') || line.length > 80) continue;
      return line;
    }

    return '';
  }

  extractHeadlineFromProfileText() {
    const root = this.getTopCardRoot();
    const headlineElement = root?.querySelector(
      '.text-body-medium.break-words, .pv-text-details__left-panel .text-body-medium, .ph5 .text-body-medium'
    );
    const headlineText = this.cleanText(headlineElement?.textContent || '');
    if (headlineText && this.isLikelyHeadlineLine(headlineText)) {
      return this.cleanJobTitle(headlineText);
    }

    const lines = this.getTopCardTextLines();
    const name = this.extractNameFromProfileText();
    const startIndex = name ? lines.findIndex(line => line === name) + 1 : 0;
    const searchLines = lines.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + 12);
    const headlineParts = [];

    for (const line of searchLines) {
      if (this.isTopCardNoiseLine(line) || this.isPronounsLine(line)) continue;
      if (line === name) continue;
      if (/^Contact info$/i.test(line) || this.isLikelyLocation(line) || this.isConnectionDegreeText(line)) {
        if (headlineParts.length) break;
        continue;
      }
      if (/\d[\d,]*\s+followers?/i.test(line)) continue;
      if (!this.isLikelyHeadlineLine(line)) continue;

      headlineParts.push(line);
      if (headlineParts.join(' ').length > 240 || /[.!?]$/.test(line)) break;
    }

    return this.cleanJobTitle(headlineParts.join(' '));
  }

  extractLocationFromProfileText() {
    const lines = this.getTopCardTextLines();
    const name = this.extractNameFromProfileText();
    const startIndex = name ? lines.findIndex(line => line === name) + 1 : 0;

    for (const line of lines.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + 18)) {
      if (this.isTopCardNoiseLine(line)) continue;
      if (this.isConnectionDegreeText(line)) continue;
      if (/^Contact info$/i.test(line)) continue;
      if (this.isLikelyLocation(line)) return line;
    }

    return '';
  }

  extractCompanyFromProfileText() {
    const topCardCompany = this.extractCompanyFromTopCardLinks();
    if (topCardCompany) return topCardCompany;

    // Only trust "at X" pattern inside the visible headline. The lines following
    // "Contact info" on the new LinkedIn top card are unreliable (they often
    // contain follower counts, mutual connections, or action-button labels like
    // "Visit my website" / "Message"), so we no longer scan them.
    const headline = this.extractHeadlineFromProfileText();
    const companyMatch = headline.match(/(?:\bat\b|@)\s+([^|•·,]+)/i);
    if (companyMatch?.[1] && this.isValidCompanyNameRelaxed(companyMatch[1])) {
      return companyMatch[1].trim();
    }

    return '';
  }

  extractCompanyFromTopCardLinks() {
    const root = this.getTopCardRoot();
    const anchors = Array.from(root?.querySelectorAll('a') || []);
    const name = this.extractNameFromProfileText();
    const headline = this.extractHeadlineFromProfileText();
    const location = this.extractLocationFromProfileText();

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const text = this.cleanTopCardCompanyText(anchor.innerText || anchor.getAttribute('aria-label') || anchor.title || '');
      const isCompanyHref = /\/company\/|currentCompany|miniCompany/i.test(href);

      if (isCompanyHref && ![name, headline, location].includes(text) && this.isValidTopCardCompany(text)) {
        return this.cleanCompanyName(text);
      }
    }

    const lines = this.getTopCardTextLines();
    const contactIndex = lines.findIndex(line => /^Contact info$/i.test(line));

    const candidates = contactIndex >= 0
      ? lines.slice(contactIndex + 1, contactIndex + 5)
      : lines.slice(0, 16);

    for (const line of candidates) {
      const text = this.cleanTopCardCompanyText(line);
      if ([name, headline, location].includes(text)) continue;
      if (this.isValidTopCardCompany(text)) return this.cleanCompanyName(text);
    }

    return '';
  }

  cleanTopCardCompanyText(text) {
    return this.cleanText(text)
      .replace(/\s*(opens in a new tab|opens profile|external link).*$/i, '')
      .replace(/\s+link$/i, '')
      .trim();
  }

  isValidTopCardCompany(text) {
    if (!text || text.length < 2 || text.length > 120) return false;
    if (this.isTopCardNoiseLine(text) || this.isPronounsLine(text)) return false;
    if (this.isLikelyLocation(text) || this.isConnectionDegreeText(text)) return false;
    if (/^\d[\d,]*\s+(followers?|connections?)$/i.test(text)) return false;
    if (/^(Contact info|Visit my website|Website|Personal website|Profile|Message|Connect|Follow|More)$/i.test(text)) return false;
    if (/mutual connections?|followers?|connections?/i.test(text)) return false;
    return true;
  }

  /**
   * Extract job title from most recent position in Experience section
   * NOTE: This extracts the job title from the first entry in the Experience section,
   * NOT the profile headline that appears under the name
   */
  extractJobTitle() {
    console.log('💼 Starting job title extraction from Experience section...');

    // Strategy 1: Find experience section contextually and extract from first item
    const experienceItem = this.findFirstExperienceItem();
    
    if (experienceItem) {
      const structuredExperienceTitle = this.extractJobTitleFromExperienceStructured(experienceItem);
      if (structuredExperienceTitle) {
        const cleaned = this.cleanJobTitle(structuredExperienceTitle);
        console.log(`  ✅ Found job title from structured Experience card: "${cleaned}"`);
        return cleaned;
      }

      // Check if grouped (multiple roles at one company) — company is bold at top, roles are nested
      const hasNestedList = this.isGroupedExperienceItem(experienceItem);
      
      let jobTitleElement;
      if (hasNestedList) {
        // Grouped: job title is in the nested first item
        jobTitleElement = experienceItem.querySelector('ul.pvs-list li:first-child span.mr1.t-bold span[aria-hidden="true"]') ||
                          experienceItem.querySelector('ul.pvs-list li:first-child .t-bold span[aria-hidden="true"]') ||
                          experienceItem.querySelector('ul.pvs-list li:first-child .t-bold');
      } else {
        // Single role: job title is the bold text
        jobTitleElement = experienceItem.querySelector('span.mr1.t-bold span[aria-hidden="true"]') ||
                          experienceItem.querySelector('span[class="mr1 t-bold"] span[aria-hidden="true"]') ||
                          experienceItem.querySelector('.t-bold span[aria-hidden="true"]') ||
                          experienceItem.querySelector('.mr1.t-bold');
      }

      if (jobTitleElement) {
        const text = this.cleanText(jobTitleElement.textContent);
        if (this.isValidJobTitle(text)) {
          const cleaned = this.cleanJobTitle(text);
          console.log(`  ✅ Found job title from experience item: "${cleaned}"`);
          return cleaned;
        }
      }

      const parsedExperienceTitle = this.extractJobTitleFromExperienceText(experienceItem);
      if (parsedExperienceTitle) {
        const cleaned = this.cleanJobTitle(parsedExperienceTitle);
        console.log(`  ✅ Parsed job title from Experience text lines: "${cleaned}"`);
        return cleaned;
      }
    }

    // Strategy 2: Global selectors as fallback
    const globalSelectors = [
      'section:has(#experience) > div > ul > li:first-child span.mr1.t-bold span[aria-hidden="true"]',
      'section:has(#experience) > div > ul > li:first-child .t-bold span[aria-hidden="true"]',
      '#experience ~ div li:first-child span.mr1.t-bold span[aria-hidden="true"]',
      '#experience ~ div li:first-child .t-bold span[aria-hidden="true"]',
      '[data-field="experience"] .pvs-list__paged-list-item:first-child .mr1.t-bold span[aria-hidden="true"]',
      'section[data-section="experience"] .pvs-list__paged-list-item:first-child .t-bold span[aria-hidden="true"]'
    ];

    for (const selector of globalSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const text = this.cleanText(element.textContent);
          if (this.isValidJobTitle(text)) {
            const cleaned = this.cleanJobTitle(text);
            console.log(`  ✅ Found job title via global selector: "${cleaned}"`);
            return cleaned;
          }
        }
      } catch (e) {
        // :has() may not be supported in all contexts
      }
    }

    // Strategy 3: Fall back to headline under the name
    const headlineTitle = this.extractJobTitleFromTopCardHeadline();
    if (headlineTitle) {
      console.log(`  ✅ Found job title from top-card headline: "${headlineTitle}"`);
      return this.cleanJobTitle(headlineTitle);
    }

    const headlineSelectors = [
      '.text-body-medium.break-words',
      '.pv-text-details__left-panel .text-body-medium',
      '.ph5 .text-body-medium'
    ];
    const headlineEl = this.findElement(headlineSelectors);
    if (headlineEl) {
      const headline = this.cleanText(headlineEl.textContent);
      const parsedHeadline = this.parseJobTitleFromHeadline(headline);
      if (parsedHeadline) {
        console.log(`  ⚠️ Using profile headline as fallback job title: "${parsedHeadline}"`);
        return this.cleanJobTitle(parsedHeadline);
      }
    }

    // Strategy 4: Derive from top-card current-company link (aria-label or ancestor text
    // often reads "Role at Company" / "Current company: Role at Company")
    const topCardTitle = this.extractJobTitleFromTopCardCompanyLink();
    if (topCardTitle) {
      console.log(`  ✅ Found job title from top-card company link: "${topCardTitle}"`);
      return this.cleanJobTitle(topCardTitle);
    }

    // Strategy 5: LinkedIn 2026 obfuscated DOM fallback — parse visible top-card text
    const textHeadline = this.extractHeadlineFromProfileText();
    if (textHeadline) {
      console.log(`  ✅ Found profile headline from visible text: "${textHeadline}"`);
      return this.cleanJobTitle(textHeadline);
    }

    console.log('  ❌ No job title found');
    return '';
  }

  extractJobTitleFromTopCardHeadline() {
    return this.parseJobTitleFromHeadline(this.extractHeadlineFromProfileText());
  }

  parseJobTitleFromHeadline(headline) {
    const cleaned = this.cleanText(headline || '');
    if (!cleaned || !this.isLikelyHeadlineLine(cleaned)) return '';

    const primary = cleaned
      .split('|')[0]
      .split('•')[0]
      .split('·')[0]
      .trim();

    if (!primary) return '';

    const atMatch = primary.match(/^(.+?)\s+(?:at|@)\s+.+$/i);
    const candidate = this.cleanJobTitle(atMatch?.[1] || primary);

    if (!this.isLikelyProfessionalTitle(candidate)) return '';
    if (!this.isValidJobTitle(candidate)) return '';

    return candidate;
  }

  isLikelyProfessionalTitle(text) {
    const cleaned = this.cleanText(text || '');
    if (!cleaned || this.isLikelyLocation(cleaned)) return false;

    const roleWords = [
      'Founder', 'Co-Founder', 'CEO', 'COO', 'CTO', 'CFO', 'CMO', 'President', 'Vice President', 'VP',
      'Director', 'Head', 'Manager', 'Lead', 'Principal', 'Senior', 'Associate', 'Partner', 'Advisor',
      'Consultant', 'Specialist', 'Analyst', 'Engineer', 'Developer', 'Designer', 'Architect', 'Strategist',
      'Officer', 'Executive', 'Coordinator', 'Producer', 'Builder', 'Owner', 'Investor', 'Professor', 'Researcher'
    ];
    const hasRoleWord = roleWords.some(word => new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(cleaned));

    if (/^(working|helping|passionate|building|creating|driving|leading with|focused on|interested in)\b/i.test(cleaned) && !hasRoleWord) {
      return false;
    }

    const wordCount = cleaned.split(/\s+/).length;
    if (wordCount > 14 && !hasRoleWord) return false;

    return hasRoleWord || wordCount <= 8;
  }

  extractJobTitleFromTopCardCompanyLink() {
    const root = this.getTopCardRoot();
    if (!root) return '';
    const anchors = Array.from(root.querySelectorAll('a'));

    const parseRoleAt = (raw) => {
      if (!raw) return '';
      const cleaned = this.cleanText(raw)
        .replace(/^current company:\s*/i, '')
        .replace(/^current position:\s*/i, '');
      // "Role at Company" pattern
      const m = cleaned.match(/^(.+?)\s+at\s+.+$/i);
      if (m && m[1] && m[1].length >= 2 && m[1].length <= 120) return m[1].trim();
      return '';
    };

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      if (!/\/company\/|currentCompany|miniCompany/i.test(href)) continue;

      // Try aria-label first
      const role = parseRoleAt(anchor.getAttribute('aria-label'))
        || parseRoleAt(anchor.title)
        // Sometimes an ancestor button/list-item contains "Role at Company"
        || parseRoleAt(anchor.closest('li, button, div')?.getAttribute('aria-label'))
        || parseRoleAt(anchor.parentElement?.textContent);

      if (role && this.isValidJobTitle(role)) return role;
    }

    // Fallback: scan text lines for "X at Y" where Y matches extracted company
    const company = this.extractCompanyFromTopCardLinks();
    if (company) {
      const lines = this.getTopCardTextLines();
      for (const line of lines) {
        const m = line.match(new RegExp('^(.+?)\\s+at\\s+' + company.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\b', 'i'));
        if (m && m[1] && this.isValidJobTitle(m[1])) return m[1].trim();
      }
    }
    return '';
  }

  extractJobTitleFromExperienceStructured(experienceItem) {
    if (!experienceItem) return '';

    const company = this.extractCompanyFromExperienceLinks(experienceItem) || this.extractCompanyFromExperienceText(experienceItem);
    const roleItem = this.isGroupedExperienceItem(experienceItem)
      ? this.getFirstNestedExperienceRoleItem(experienceItem)
      : experienceItem;

    const candidates = this.getExperienceTitleCandidates(roleItem || experienceItem);
    for (const candidate of candidates) {
      if (this.isValidExperienceJobTitle(candidate, company)) {
        return this.cleanExperienceJobTitleCandidate(candidate);
      }
    }

    return '';
  }

  getExperienceTitleCandidates(element) {
    if (!element) return [];

    const candidates = this.getBoldExperienceTextCandidates(element);

    const lines = this.getElementTextLines(element).slice(0, 10);
    for (const line of lines) {
      const text = this.cleanExperienceJobTitleCandidate(line);
      if (text) candidates.push(text);
    }

    const seen = new Set();
    return candidates.filter(candidate => {
      const key = candidate.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  getBoldExperienceTextCandidates(element) {
    if (!element) return [];

    const candidates = [];
    const selectors = [
      ':scope .display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]',
      ':scope .mr1.t-bold span[aria-hidden="true"]',
      ':scope .hoverable-link-text.t-bold span[aria-hidden="true"]',
      ':scope .t-bold span[aria-hidden="true"]',
      ':scope h3 span[aria-hidden="true"]',
      ':scope h3',
      ':scope strong'
    ];

    for (const selector of selectors) {
      try {
        for (const node of element.querySelectorAll(selector)) {
          const text = this.cleanExperienceJobTitleCandidate(node.textContent || '');
          if (text) candidates.push(text);
        }
      } catch (e) { /* invalid selector in older browsers */ }
    }

    const seen = new Set();
    return candidates.filter(candidate => {
      const key = candidate.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  isGroupedExperienceItem(experienceItem) {
    if (!experienceItem) return false;
    if (!this.getFirstNestedExperienceRoleItem(experienceItem)) return false;

    const lines = this.getElementTextLines(experienceItem).slice(0, 6);
    const firstLine = this.cleanExperienceCompanyCandidate(lines[0] || '');
    const company = this.extractCompanyFromExperienceLinks(experienceItem) || this.extractCompanyFromExperienceText(experienceItem);
    const normalizedFirst = firstLine.toLowerCase();
    const normalizedCompany = this.cleanCompanyName(company || '').toLowerCase();

    if (normalizedFirst && normalizedCompany && normalizedFirst === normalizedCompany) return true;
    if (lines.some(line => /^total\s+duration\s+/i.test(line))) return true;

    return false;
  }

  getFirstNestedExperienceRoleItem(experienceItem) {
    if (!experienceItem) return null;

    const nestedLists = Array.from(experienceItem.querySelectorAll('ul.pvs-list, ul[role="list"], ul'))
      .filter(list => {
        const parentListItem = list.closest('li, [role="listitem"]');
        return parentListItem && parentListItem !== list && experienceItem.contains(parentListItem);
      });

    for (const list of nestedLists) {
      const directItems = Array.from(list.children).flatMap(child => {
        if (child.matches('li, [role="listitem"], .pvs-list__paged-list-item')) return [child];
        return Array.from(child.querySelectorAll(':scope > li, :scope > [role="listitem"], :scope > .pvs-list__paged-list-item'));
      });

      const roleItem = directItems.find(item =>
        this.getBoldExperienceTextCandidates(item).some(line => this.isValidExperienceJobTitle(line))
      );
      if (roleItem) return roleItem;
    }

    return null;
  }

  cleanExperienceJobTitleCandidate(text) {
    return this.cleanJobTitle(text)
      .replace(/^title\s*[:\-]\s*/i, '')
      .replace(/\s*(job\s+title|position)$/i, '')
      .trim();
  }

  parseExperienceTitleFromLine(line, company = '') {
    const cleaned = this.cleanText(line || '');
    if (!cleaned) return '';

    const separators = ['·', '•', '|'];
    for (const separator of separators) {
      if (!cleaned.includes(separator)) continue;
      const firstPart = this.cleanExperienceJobTitleCandidate(cleaned.split(separator)[0]);
      if (this.isValidExperienceJobTitle(firstPart, company)) return firstPart;
    }

    const atMatch = cleaned.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (atMatch?.[1]) {
      const candidate = this.cleanExperienceJobTitleCandidate(atMatch[1]);
      if (this.isValidExperienceJobTitle(candidate, company || atMatch[2])) return candidate;
    }

    return '';
  }

  isValidExperienceJobTitle(text, company = '') {
    const cleaned = this.cleanExperienceJobTitleCandidate(text);
    if (!cleaned || cleaned.length < 2 || cleaned.length > 160) return false;
    if (this.isExperienceMetadataLine(cleaned)) return false;
    if (/^(Experience|Company name|Current company|Current position)$/i.test(cleaned)) return false;

    const cleanedCompany = this.cleanCompanyName(company || '').toLowerCase();
    if (cleanedCompany && cleaned.toLowerCase() === cleanedCompany) return false;
    if (this.isValidExperienceCompanyName(cleaned) && cleanedCompany && cleaned.toLowerCase().includes(cleanedCompany)) return false;

    return this.isValidJobTitle(cleaned);
  }

  extractJobTitleFromExperienceText(experienceItem) {
    const company = this.extractCompanyFromExperienceLinks(experienceItem) || this.extractCompanyFromExperienceText(experienceItem);
    const hasNestedList = this.hasNestedExperienceList(experienceItem);

    if (hasNestedList) {
      const nestedRoleItem = this.getFirstNestedExperienceRoleItem(experienceItem);
      const nestedLines = this.getElementTextLines(nestedRoleItem).slice(0, 8);

      for (const line of nestedLines) {
        const candidate = this.cleanExperienceJobTitleCandidate(line);
        if (this.isValidExperienceJobTitle(candidate, company)) return candidate;
      }
    }

    const lines = this.getElementTextLines(experienceItem).slice(0, 14);
    if (!lines.length) return '';

    if (!hasNestedList) {
      for (const line of lines.slice(0, 4)) {
        const parsed = this.parseExperienceTitleFromLine(line, company);
        if (parsed) return parsed;
      }

      const firstLine = this.cleanExperienceJobTitleCandidate(lines[0]);
      if (this.isValidExperienceJobTitle(firstLine, company)) return firstLine;
    }

    for (const line of lines) {
      const candidate = this.cleanExperienceJobTitleCandidate(line);
      if (company && candidate.toLowerCase() === this.cleanCompanyName(company).toLowerCase()) continue;
      if (this.isValidExperienceJobTitle(candidate, company)) return candidate;
    }

    return '';
  }

  /**
   * Clean job title text (remove extra info and formatting)
   */
  cleanJobTitle(jobTitle) {
    if (!jobTitle) return '';

    return jobTitle
      .replace(/^at\s+/i, '')                    // Remove "at Company"
      .replace(/^company:\s*/i, '')              // Remove "Company: Name"
      .replace(/\s*·\s*(Full-time|Part-time|Contract|Freelance|Internship|Self-employed).*$/i, '') // Remove employment type
      .replace(/\s*-\s*(Full-time|Part-time|Contract|Freelance|Internship|Self-employed).*$/i, '') // Remove employment type with dash
      .replace(/\s*•.*$/, '')                    // Remove bullet points and following text
      .replace(/\s*\|.*$/, '')                   // Remove pipe separators and following text
      .replace(/\s*·.*$/, '')                    // Remove middle dots and following text
      .replace(/\s*\(.*\)$/, '')                 // Remove parenthetical info
      .replace(/\s*\d+\s*yr(s)?.*$/i, '')        // Remove duration like "2 yrs 3 mos"
      .replace(/\s*\d{4}\s*[-–].*$/i, '')        // Remove date ranges
      .replace(/\s+/g, ' ')                      // Replace multiple spaces with single space
      .trim();
  }

  /**
   * Clean company name text (remove extra info and formatting)
   */
  cleanCompanyName(company) {
    if (!company) return '';

    return company
      // Remove employment type indicators
      .replace(/\s*·\s*(Full-time|Part-time|Contract|Freelance|Internship|Self-employed).*$/i, '')
      .replace(/\s*-\s*(Full-time|Part-time|Contract|Freelance|Internship|Self-employed).*$/i, '')

      // Remove employee count and company info
      .replace(/\s*\([\d,]+\+?\s*employees?\)/i, '')  // Remove "(1,000+ employees)"
      .replace(/\s*\(.*\)$/, '')                      // Remove other parenthetical info

      // Remove duration and dates
      .replace(/\s*·\s*\d+\s*yr(s)?.*$/i, '')         // Remove "· 2 yrs 3 mos"
      .replace(/\s*\d+\s*yr(s)?\s*\d*\s*mo(s)?.*$/i, '') // Remove duration
      .replace(/\s*\d{4}\s*[-–].*$/i, '')              // Remove date ranges

      // Remove location if it leaked through
      .replace(/\s*,\s*[A-Z][a-z]+.*$/, '')           // Remove ", City, State"

      // Remove bullets and separators
      .replace(/\s*•.*$/, '')                          // Remove bullet points and following text
      .replace(/\s*\|.*$/, '')                         // Remove pipe separators and following text
      .replace(/\s*·.*$/, '')                          // Remove middle dots and following text

      // Remove common prefixes
      .replace(/^company:\s*/i, '')                    // Remove "Company:" prefix
      .replace(/^at\s+/i, '')                          // Remove "at" prefix

      // Remove link text artifacts
      .replace(/\s*link$/i, '')                        // Remove "Company name link"
      .replace(/\s*page$/i, '')                        // Remove "Company page"

      // Clean up whitespace and punctuation
      .replace(/\s*\.\s*$/, '')                       // Remove trailing dots
      .replace(/\s+/g, ' ')                            // Replace multiple spaces with single space
      .replace(/^[\s-]+|[\s-]+$/g, '')                 // Trim spaces and dashes
      .trim();
  }

  /**
   * Find the first experience item on the page (shared by job title and company extraction)
   */
  findFirstExperienceItem() {
    const experienceSection = this.getExperienceSection();
    const directItem = this.findFirstDirectExperienceItem(experienceSection);
    if (directItem) {
      console.log('  ✅ Found top-level experience item via section list parsing');
      return directItem;
    }

    const selectors = [
      'section:has(#experience) > div > ul > li:first-child',
      'section:has(#experience) li:first-child',
      '[data-field="experience"] .pvs-list__paged-list-item:first-child',
      'section[data-section="experience"] li:first-child',
      '#experience ~ div li:first-child',
      '#experience + div li:first-child'
    ];

    for (const selector of selectors) {
      try {
        const item = document.querySelector(selector);
        if (item) {
          console.log(`  ✅ Found experience item with: ${selector}`);
          return item;
        }
      } catch (e) { /* :has() may fail in some contexts */ }
    }

    const modernExperienceSection = this.findProfileSectionByHeading('Experience');
    if (modernExperienceSection) {
      const item = modernExperienceSection.querySelector('ul li:first-child, li:first-child, [role="listitem"]');
      if (item) {
        console.log('  ✅ Found experience item via heading-based LinkedIn 2026 fallback');
        return item;
      }
    }

    // Text-based fallback: find section containing "Experience" heading
    const allSections = document.querySelectorAll('section');
    for (const section of allSections) {
      const heading = section.querySelector('h2, h3, [id="experience"], [id*="experience"]');
      if (heading && heading.textContent.toLowerCase().includes('experience')) {
        const item = section.querySelector('li:first-child, ul > div:first-child');
        if (item) {
          console.log('  ✅ Found experience item via text-based search');
          return item;
        }
      }
    }

    console.log('  ❌ No experience items found');
    return null;
  }

  getExperienceSection() {
    const selectors = [
      'section:has(#experience)',
      '[data-field="experience"]',
      'section[data-section="experience"]'
    ];

    for (const selector of selectors) {
      try {
        const section = document.querySelector(selector);
        if (section) return section;
      } catch (e) { /* :has() may fail in some contexts */ }
    }

    return this.findProfileSectionByHeading('Experience');
  }

  findFirstDirectExperienceItem(section) {
    if (!section) return null;

    const listCandidates = Array.from(section.querySelectorAll('ul.pvs-list, ul[role="list"], ul'));
    for (const list of listCandidates) {
      // Nested role lists inside a grouped company card should not be treated as
      // the top-level Experience list, otherwise company extraction starts from
      // a role item instead of the company card.
      const parentListItem = list.closest('li, [role="listitem"]');
      if (parentListItem && section.contains(parentListItem)) continue;

      const directItems = Array.from(list.children).flatMap(child => {
        if (child.matches('li, [role="listitem"], .pvs-list__paged-list-item')) return [child];
        return Array.from(child.querySelectorAll(':scope > li, :scope > [role="listitem"], :scope > .pvs-list__paged-list-item'));
      });

      const item = directItems.find(candidate => this.isLikelyExperienceCard(candidate));
      if (item) return item;
    }

    const fallbackItems = Array.from(section.querySelectorAll('.pvs-list__paged-list-item, li.artdeco-list__item, [role="listitem"], li'));
    return fallbackItems.find(candidate => this.isLikelyExperienceCard(candidate)) || fallbackItems[0] || null;
  }

  isLikelyExperienceCard(candidate) {
    const lines = this.getElementTextLines(candidate).slice(0, 12);
    if (lines.length < 2) return false;
    if (lines.some(line => /^(Experience|Show all|See more|See less)$/i.test(line))) return false;

    const hasCompanyLink = !!candidate.querySelector('a[href*="/company/"], a[href*="currentCompany"], a[href*="miniCompany"]');
    const hasDates = lines.some(line => this.isExperienceDateOrDurationLine(line));
    const hasEmployment = lines.some(line => /\b(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Temporary|Seasonal)\b/i.test(line));
    const hasValidTitle = lines.some(line => this.isValidExperienceJobTitle(line));
    const hasValidCompany = lines.some(line => this.isValidExperienceCompanyName(line));

    return hasCompanyLink || (hasDates && (hasValidTitle || hasValidCompany || hasEmployment));
  }

  findProfileSectionByHeading(headingText) {
    const normalizedHeading = headingText.toLowerCase();
    const main = document.querySelector('main') || document.body;
    const candidates = main.querySelectorAll('h1, h2, h3, span, div');

    for (const candidate of candidates) {
      const text = this.cleanText(candidate.textContent);
      if (text.toLowerCase() !== normalizedHeading) continue;

      const section = candidate.closest('section');
      if (section) return section;

      let parent = candidate.parentElement;
      for (let depth = 0; parent && depth < 5; depth++) {
        if (parent.querySelector('ul li, [role="listitem"]')) return parent;
        parent = parent.parentElement;
      }
    }

    return null;
  }

  getElementTextLines(element) {
    const rawText = element?.innerText || element?.textContent || '';
    const seen = new Set();

    return rawText
      .split('\n')
      .map(line => this.cleanText(line))
      .filter(Boolean)
      .filter(line => {
        const key = line.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  hasNestedExperienceList(experienceItem) {
    return !!this.getFirstNestedExperienceRoleItem(experienceItem);
  }

  cleanExperienceCompanyCandidate(text) {
    return this.cleanCompanyName(text)
      .replace(/\s*(company\s+page|company\s+logo|logo)$/i, '')
      .replace(/^company\s+name\s*[:\-]\s*/i, '')
      .trim();
  }

  isExperienceMetadataLine(text) {
    if (!text) return true;

    const metadataPatterns = [
      /^(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Temporary|Seasonal)$/i,
      /^·?\s*(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Temporary|Seasonal)$/i,
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{4}\s*[-–].*$/i,
      /^\d{4}\s*[-–]\s*(\d{4}|Present|Current)$/i,
      /^\d+\s*yr(s)?(\s+\d+\s*mo(s)?)?$/i,
      /^\d+\s*mo(s)?$/i,
      /^Present$/i,
      /^(Show all|See more|See less|Experience|Company name)$/i
    ];

    return metadataPatterns.some(pattern => pattern.test(text)) ||
      this.isTopCardNoiseLine(text) ||
      this.isConnectionDegreeText(text) ||
      this.isLikelyLocation(text);
  }

  isValidExperienceCompanyName(text) {
    const cleaned = this.cleanExperienceCompanyCandidate(text);
    if (!cleaned || cleaned.length < 2 || cleaned.length > 150) return false;
    if (this.isExperienceMetadataLine(cleaned)) return false;
    if (/^(Current company|Current position)$/i.test(cleaned)) return false;
    return true;
  }

  extractCompanyFromExperienceLinks(experienceItem) {
    const companyLinks = Array.from(experienceItem?.querySelectorAll(
      'a[href*="/company/"], a[href*="currentCompany"], a[href*="miniCompany"], a[data-field*="company"]'
    ) || []);

    for (const link of companyLinks) {
      const values = [
        ...this.getElementTextLines(link),
        link.getAttribute('aria-label') || '',
        link.getAttribute('title') || '',
        ...Array.from(link.querySelectorAll('img')).map(img => img.getAttribute('alt') || '')
      ];

      for (const value of values) {
        const candidate = this.cleanExperienceCompanyCandidate(value);
        if (this.isValidExperienceCompanyName(candidate)) return candidate;
      }
    }

    return '';
  }

  extractCompanyFromExperienceText(experienceItem) {
    const lines = this.getElementTextLines(experienceItem).slice(0, 12);
    if (!lines.length) return '';

    const hasNestedList = this.hasNestedExperienceList(experienceItem);
    const firstLine = this.cleanExperienceCompanyCandidate(lines[0]);

    // Grouped Experience cards are usually:
    // Company Name / Duration / nested role title / dates...
    if (hasNestedList && this.isValidExperienceCompanyName(firstLine)) {
      return firstLine;
    }

    for (const line of lines) {
      const splitCompany = this.parseExperienceCompanyFromLine(line);
      if (splitCompany) return splitCompany;

      const employmentMatch = line.match(/^(.+?)\s*[·•|-]\s*(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Temporary|Seasonal)\b/i);
      if (employmentMatch?.[1]) {
        const candidate = this.cleanExperienceCompanyCandidate(employmentMatch[1]);
        if (this.isValidExperienceCompanyName(candidate)) return candidate;
      }
    }

    // Single-role cards are usually:
    // Job Title / Company · Employment type / Dates / Location
    for (const line of lines.slice(1, 6)) {
      const candidate = this.cleanExperienceCompanyCandidate(line);
      if (this.isValidExperienceCompanyName(candidate)) return candidate;
    }

    return '';
  }

  parseExperienceCompanyFromLine(line) {
    const cleaned = this.cleanText(line || '');
    if (!cleaned) return '';

    const atMatch = cleaned.match(/^.+?\s+(?:at|@)\s+(.+)$/i);
    if (atMatch?.[1]) {
      const candidate = this.cleanExperienceCompanyCandidate(atMatch[1]);
      if (this.isValidExperienceCompanyName(candidate)) return candidate;
    }

    const parts = cleaned.split(/[·•|]/).map(part => this.cleanText(part)).filter(Boolean);
    if (parts.length >= 2) {
      const companyPart = this.cleanExperienceCompanyCandidate(parts[1]);
      if (this.isValidExperienceCompanyName(companyPart)) return companyPart;
    }

    return '';
  }

  /**
   * Extract company from most recent position in Experience section
   */
  extractCompany() {
    console.log('🏢 Starting company extraction from Experience section...');

    const experienceItem = this.findFirstExperienceItem();

    if (experienceItem) {
      const hasNestedList = experienceItem.querySelector('ul.pvs-list') !== null;
      console.log(`  Experience layout: ${hasNestedList ? 'Grouped' : 'Single role'}`);

      const linkedCompany = this.extractCompanyFromExperienceLinks(experienceItem);
      if (linkedCompany) {
        const cleaned = this.cleanCompanyName(linkedCompany);
        console.log(`  ✅ Found company from Experience company link: "${cleaned}"`);
        return cleaned;
      }

      let companyElement;
      if (hasNestedList) {
        // Grouped: company name is the bold text at the top level (not in nested list)
        companyElement = experienceItem.querySelector(':scope > div span.mr1.t-bold span[aria-hidden="true"]') ||
                         experienceItem.querySelector(':scope > div .t-bold span[aria-hidden="true"]') ||
                         experienceItem.querySelector(':scope > div .t-bold');
      } else {
        // Single role: company is the normal (non-bold) text, typically second span
        companyElement = experienceItem.querySelector('span.t-14.t-normal span[aria-hidden="true"]') ||
                         experienceItem.querySelector('span[class="t-14 t-normal"] span[aria-hidden="true"]') ||
                         experienceItem.querySelector('.t-14.t-normal:not(.t-bold) span[aria-hidden="true"]') ||
                         experienceItem.querySelector('.t-14.t-normal:not(.t-bold)');
      }

      if (companyElement) {
        const text = this.cleanText(companyElement.textContent);
        if (this.isValidCompanyName(text)) {
          const cleaned = this.cleanCompanyName(text);
          console.log(`  ✅ Found company from experience item: "${cleaned}"`);
          return cleaned;
        }
      }

      // Fallback: scan all non-bold text elements in the experience item
      console.log('  ⚠️ Direct selectors failed, trying fallback scan...');
      const company = this.extractCompanyFallback(experienceItem);
      if (company) {
        const cleaned = this.cleanCompanyName(company);
        console.log(`  ✅ Fallback found company: "${cleaned}"`);
        return cleaned;
      }

      const parsedCompany = this.extractCompanyFromExperienceText(experienceItem);
      if (parsedCompany) {
        const cleaned = this.cleanCompanyName(parsedCompany);
        console.log(`  ✅ Parsed company from Experience text lines: "${cleaned}"`);
        return cleaned;
      }
    }

    // Global selector fallback
    const globalSelectors = [
      'section:has(#experience) > div > ul > li:first-child span.t-14.t-normal span[aria-hidden="true"]',
      '#experience ~ div li:first-child span.t-14.t-normal span[aria-hidden="true"]',
      '[data-field="experience"] .pvs-list__paged-list-item:first-child .t-14.t-normal span[aria-hidden="true"]'
    ];

    for (const selector of globalSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const text = this.cleanText(element.textContent);
          if (this.isValidCompanyName(text)) {
            const cleaned = this.cleanCompanyName(text);
            console.log(`  ✅ Found company via global selector: "${cleaned}"`);
            return cleaned;
          }
        }
      } catch (e) { /* :has() may fail */ }
    }

    const textCompany = this.extractCompanyFromProfileText();
    if (textCompany) {
      const cleaned = this.cleanCompanyName(textCompany);
      console.log(`  ✅ Found company from visible top-card text: "${cleaned}"`);
      return cleaned;
    }

    console.log('  ❌ No company found');
    return '';
  }

  /**
   * Fallback method to extract company when standard selectors fail
   */
  extractCompanyFallback(experienceItem) {
    console.log('🔍 Attempting fallback company extraction...');

    const allTextElements = experienceItem.querySelectorAll('.t-14, .t-normal, span[aria-hidden="true"]');
    console.log(`  Found ${allTextElements.length} potential text elements`);

    for (let i = 0; i < allTextElements.length; i++) {
      const element = allTextElements[i];
      const text = this.cleanText(element.textContent);

      // Skip empty, too-short, or any element nested inside a bold span (job title)
      if (!text || text.length < 2 || element.closest('.t-bold')) {
        continue;
      }

      console.log(`  Fallback candidate ${i + 1}: "${text}"`);

      if (this.isValidCompanyNameRelaxed(text)) {
        console.log(`  ✅ Fallback found valid company: "${text}"`);
        return text;
      }
    }

    console.log('  ❌ Fallback extraction found no valid company');
    return '';
  }

  /**
   * Validate if extracted text is a valid company name (strict)
   */
  isValidCompanyName(text) {
    if (!text || text.length < 2) {
      console.log('    Validation failed: Text too short');
      return false;
    }

    // Company names should be reasonable length
    if (text.length > 150) {
      console.log('    Validation failed: Text too long for company name');
      return false;
    }

    // Reject if it's just employment type
    const employmentTypePatterns = [
      /^(Full-time|Part-time|Contract|Freelance|Internship|Self-employed)$/i,
      /^·\s*(Full-time|Part-time|Contract|Freelance|Internship)$/i
    ];

    for (const pattern of employmentTypePatterns) {
      if (pattern.test(text)) {
        console.log(`    Validation failed: Looks like employment type: ${pattern}`);
        return false;
      }
    }

    // Reject if it's just a date or duration
    const datePatterns = [
      /^\d{4}\s*[-–]\s*(\d{4}|Present|Current)$/i,
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i,
      /^\d+\s*yr(s)?\s*\d*\s*mo(s)?$/i,
      /^\d+\s*yr(s)?$/i
    ];

    for (const pattern of datePatterns) {
      if (pattern.test(text)) {
        console.log(`    Validation failed: Looks like date/duration: ${pattern}`);
        return false;
      }
    }

    // Reject common job title patterns (to avoid confusion)
    const jobTitlePatterns = [
      /^(Senior|Junior|Lead|Principal|Chief|Head of|Director of|Manager of|Associate)/i,
      /Engineer$/i,
      /Developer$/i,
      /Designer$/i,
      /Analyst$/i,
      /Consultant$/i,
      /Specialist$/i
    ];

    // Only reject if it STRONGLY looks like a job title (be less strict)
    let jobTitleScore = 0;
    for (const pattern of jobTitlePatterns) {
      if (pattern.test(text)) jobTitleScore++;
    }

    if (jobTitleScore >= 2) {
      console.log('    Validation failed: Strongly resembles a job title');
      return false;
    }

    // Reject UI elements
    const uiElements = [
      /^(Message|Connect|Follow|More|Experience|Show all|See less)$/i,
      /^(Edit|Delete|Add|Remove)$/i,
      /^Company name$/i
    ];

    for (const pattern of uiElements) {
      if (pattern.test(text)) {
        console.log(`    Validation failed: Looks like UI element: ${pattern}`);
        return false;
      }
    }

    // Reject connection degree text
    if (this.isConnectionDegreeText(text)) {
      console.log('    Validation failed: Looks like connection degree text');
      return false;
    }

    console.log('    Validation passed: Text appears to be a valid company name');
    return true;
  }

  /**
   * Relaxed validation for fallback company extraction
   */
  isValidCompanyNameRelaxed(text) {
    if (!text || text.length < 2) return false;
    if (text.length > 150) return false;

    // Only reject obvious non-company patterns
    const rejectPatterns = [
      /^(Full-time|Part-time|Contract|Freelance|Internship)$/i,
      /^\d{4}\s*[-–]\s*(\d{4}|Present)$/i,
      /^\d+\s*yr(s)?\s*\d*\s*mo(s)?$/i,
      /^(Message|Connect|Follow|More|Show all)$/i
    ];

    return !rejectPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Extract location from profile
   */
  extractLocation() {
    let location = this.extractLocationFromProfileText();

    const selectors = [
      // More specific location selectors that avoid connection degree text
      '.pv-text-details__left-panel .text-body-small.inline.t-black--light.break-words',
      '.pv-text-details__left-panel .text-body-small:not([aria-label*="connection"])',
      '.pv-text-details__left-panel .text-body-small.inline:last-child',
      '.pv-top-card .text-body-small.inline.t-black--light:not(:first-child)',
      '.ph5 .text-body-small.inline.t-black--light',
      '.pv-top-card--list-bullet .text-body-small',
      '[data-generated-suggestion-target] ~ .text-body-small.inline.t-black--light'
    ];
    const element = !location ? this.findElement(selectors) : null;
    const selectorLocation = element ? this.cleanText(element.textContent) : '';

    if (!location && selectorLocation && !this.isConnectionDegreeText(selectorLocation) && this.isLikelyLocation(selectorLocation)) {
      location = selectorLocation;
    }

    console.log('📍 Location extraction:');
    console.log(`  Raw text: "${element ? element.textContent : 'No element found'}"`);
    console.log(`  After cleanText: "${location}"`);
    console.log('✅ Extracted location:', location);
    return location;
  }

  /**
   * Check if text is connection degree related
   */
  isConnectionDegreeText(text) {
    const connectionPatterns = [
      /\d+(st|nd|rd|th)\s*degree/i,
      /^[·•]?\s*\d+(st|nd|rd|th)\s*$/i,
      /\d+\s*connection/i,
      /mutual connection/i,
      /follow/i,
      /message/i,
      /connect/i
    ];
    
    return connectionPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Validate if extracted text is a valid job title from Experience section
   */
  isValidJobTitle(text) {
    if (!text || text.length < 2) {
      console.log('    Validation failed: Text too short');
      return false;
    }

    // Job titles should be reasonable length
    if (text.length > 200) {
      console.log('    Validation failed: Text too long for job title');
      return false;
    }

    // Reject if it's just a date or date range (sometimes first element might be duration)
    const dateOnlyPatterns = [
      /^\d{4}\s*[-–]\s*(\d{4}|Present|Current)$/i,
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*[-–].*$/i,
      /^\d+\s*yr(s)?\s*\d*\s*mo(s)?$/i
    ];

    for (const pattern of dateOnlyPatterns) {
      if (pattern.test(text)) {
        console.log(`    Validation failed: Looks like date/duration only: ${pattern}`);
        return false;
      }
    }

    // Reject if it looks like connection degree or UI text
    if (this.isConnectionDegreeText(text)) {
      console.log('    Validation failed: Looks like connection degree text');
      return false;
    }

    // Reject common UI elements or section headers
    const uiElements = [
      /^(Message|Connect|Follow|More|Experience|Show all|See less)$/i,
      /^\d+(st|nd|rd|th)\s*$/i,
      /^(Edit|Delete|Add|Remove)$/i
    ];

    for (const pattern of uiElements) {
      if (pattern.test(text)) {
        console.log(`    Validation failed: Looks like UI element: ${pattern}`);
        return false;
      }
    }

    // Reject if text looks like a company name pattern (all caps, common suffixes)
    const companyPatterns = [
      /^[A-Z\s&,\.]+\s+(Inc\.|LLC|Ltd\.|Corp\.|Corporation|Company)$/i
    ];

    for (const pattern of companyPatterns) {
      if (pattern.test(text)) {
        console.log(`    Validation failed: Looks like company name: ${pattern}`);
        return false;
      }
    }

    console.log('    Validation passed: Text appears to be a valid job title');
    return true;
  }

  /**
   * Check if text is likely a geographical location
   */
  isLikelyLocation(text) {
    const cleaned = this.cleanText(text || '');
    if (!cleaned || cleaned.length > 120) return false;
    if (this.isTopCardNoiseLine(cleaned) || this.isConnectionDegreeText(cleaned) || this.isPronounsLine(cleaned)) return false;
    if (/[|]/.test(cleaned)) return false;

    const roleOrHeadlineWords = /\b(VP|Vice President|Founder|CEO|COO|CTO|CFO|CMO|Director|Head|Manager|Lead|Principal|Senior|Associate|Partner|Advisor|Consultant|Specialist|Analyst|Engineer|Developer|Designer|Architect|Strategist|Officer|Executive|Coordinator|Producer|Builder|Strategy|Risk|Capital|Product|Working|Helping|Building|Creating|Driving)\b/i;
    if (roleOrHeadlineWords.test(cleaned)) return false;
    if (/\b(at|@)\b/i.test(cleaned) && !/\b(based|located)\s+in\b/i.test(cleaned)) return false;
    if (/[.!?]$/.test(cleaned)) return false;

    const countryOrRegion = /\b(Canada|United States|USA|U\.S\.|United Kingdom|UK|Australia|India|Germany|France|Spain|Italy|Netherlands|Ireland|Singapore|UAE|Mexico|Brazil|Ontario|Quebec|British Columbia|Alberta|California|New York|Texas|Florida|Illinois|Washington|Massachusetts)\b/i;
    const areaWords = /\b(Greater\s+.+\s+Area|Area|Region|Metro|Metropolitan Area|Province|State|County|District)\b/i;
    if (countryOrRegion.test(cleaned) || areaWords.test(cleaned) || /,\s*[A-Z]{2}\b/.test(cleaned)) return true;

    const parts = cleaned.split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 4) {
      return parts.every(part =>
        part.length > 1 &&
        part.length < 40 &&
        !roleOrHeadlineWords.test(part) &&
        /^[A-Z][A-Za-zÀ-ÿ.'\-\s]+$/.test(part)
      );
    }

    return false;
  }


  /**
   * Extract profile picture URL
   */
  extractProfilePicture() {
    const selectors = [
      'img.pv-top-card-profile-picture__image--show',
      'img.pv-top-card-profile-picture__image',
      'button img.profile-photo-edit__preview',
      '.pv-top-card__photo img',
      '.presence-entity__image img',
      '.profile-photo-edit__preview img',
      '.pv-top-card--photo img',
      'main img[width="200"]'
    ];

    const isValidPhoto = (src) =>
      !!src &&
      !src.includes('chrome-extension://invalid') &&
      !src.startsWith('data:') &&
      !/ghost[-_]?person/i.test(src) &&
      !/profile-displaybackgroundimage/i.test(src);

    const element = this.findElement(selectors);
    if (element && isValidPhoto(element.src)) return element.src;

    // 2026 LinkedIn fallback: scan main for the first licdn profile image.
    const main = document.querySelector('main') || document.body;
    const imgs = Array.from(main.querySelectorAll('img'));
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (!isValidPhoto(src)) continue;
      if (!/media\.licdn\.com|licdn\.com\/dms\/image/i.test(src)) continue;
      // Skip the cover/background photo (usually much wider than tall).
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w && h && w > h * 1.4) continue;
      return src;
    }

    return '';
  }

  /**
   * Find element using multiple selectors (fallback approach)
   */
  findElement(selectors) {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return element;
        }
      } catch (e) { /* invalid selector in this browser, skip */ }
    }
    return null;
  }

  /**
   * Diagnostic: dump key DOM structures so we can see what LinkedIn is actually rendering.
   * Output goes to the page console (run on the LinkedIn tab, not the side panel).
   */
  dumpDomDiagnostics() {
    try {
      console.group('🔬 LinkedIn DOM Diagnostics');

      // Context — is this even the right document?
      console.log('URL:', window.location.href);
      console.log('Document title:', document.title);
      console.log('In iframe?:', window.top !== window.self);
      console.log('readyState:', document.readyState);
      console.log('document.body length:', document.body?.innerHTML?.length);
      console.log('document.body innerText (first 300):', document.body?.innerText?.slice(0, 300));

      const main = document.querySelector('main');
      console.log('main element present:', !!main);
      if (main) {
        console.log('main innerHTML length:', main.innerHTML.length);
        console.log('main innerText (first 400):', main.innerText.slice(0, 400));
        console.log('main child tag list:', Array.from(main.children).map(c => `${c.tagName.toLowerCase()}.${c.className?.toString().slice(0,60)}`));
      }

      // Headings at every level
      ['h1','h2','h3'].forEach(tag => {
        const els = Array.from(document.querySelectorAll(tag));
        console.log(`Found ${els.length} <${tag}> on page:`);
        els.slice(0, 5).forEach((h, i) => {
          console.log(`  ${tag}[${i}] class="${h.className}" text="${h.textContent.trim().slice(0, 100)}"`);
        });
      });

      // Any section IDs (LinkedIn uses #experience, #education, etc.)
      const sectionIds = Array.from(document.querySelectorAll('section[id], div[id]'))
        .map(el => el.id).filter(Boolean).slice(0, 30);
      console.log('section/div IDs on page:', sectionIds);

      // Any element whose class hints at name/headline/heading
      const hinted = Array.from(document.querySelectorAll('[class*="heading"], [class*="headline"], [class*="profile-name"], [data-anonymize]'));
      console.log(`Found ${hinted.length} hinted name/heading elements (first 8):`);
      hinted.slice(0, 8).forEach((el, i) => {
        console.log(`  [${i}] <${el.tagName.toLowerCase()}> class="${el.className?.toString().slice(0,80)}" text="${el.textContent.trim().slice(0, 100)}"`);
      });

      const expSection = document.querySelector('#experience')?.closest('section') ||
        document.querySelector('section:has(#experience)') ||
        this.findProfileSectionByHeading('Experience');
      console.log('experience section found:', !!expSection);
      if (expSection) {
        const firstLi = expSection.querySelector('li');
        console.log('first experience <li> HTML (first 800 chars):');
        console.log(firstLi ? firstLi.outerHTML.slice(0, 800) : '(no <li>)');
      }

      console.log('text fallback extraction preview:', {
        name: this.extractNameFromProfileText(),
        headline: this.extractHeadlineFromProfileText(),
        company: this.extractCompanyFromProfileText(),
        location: this.extractLocationFromProfileText()
      });

      console.groupEnd();
    } catch (e) {
      console.warn('DOM diagnostics failed:', e);
    }
  }

  getExtractionDebugSnapshot() {
    const experienceSection = this.getExperienceSection();
    const experienceItem = this.findFirstExperienceItem();
    const nestedRoleItem = this.getFirstNestedExperienceRoleItem(experienceItem);

    return {
      url: window.location.href,
      title: document.title,
      experienceSectionFound: !!experienceSection,
      experienceItemFound: !!experienceItem,
      isGroupedExperienceItem: this.isGroupedExperienceItem(experienceItem),
      experienceItemLines: this.getElementTextLines(experienceItem).slice(0, 20),
      nestedRoleLines: this.getElementTextLines(nestedRoleItem).slice(0, 12),
      structuredTitle: this.extractJobTitleFromExperienceStructured(experienceItem),
      parsedTitle: this.extractJobTitleFromExperienceText(experienceItem),
      companyFromLinks: this.extractCompanyFromExperienceLinks(experienceItem),
      companyFromText: this.extractCompanyFromExperienceText(experienceItem),
      finalJobTitle: this.extractJobTitle(),
      finalCompany: this.extractCompany(),
      finalLocation: this.extractLocation()
    };
  }


  /**
   * Clean extracted text data
   */
  cleanText(text) {
    if (!text) return '';
    
    return text
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .replace(/\n/g, ' ') // Replace newlines with spaces
      .trim()
      .substring(0, 1000); // Limit length to prevent overly long data
  }

  /**
   * Clean and validate all profile data
   */
  cleanProfileData(data) {
    const cleaned = {};

    Object.keys(data).forEach(key => {
      if (typeof data[key] === 'string') {
        cleaned[key] = this.cleanText(data[key]);
      } else {
        cleaned[key] = data[key];
      }
    });

    cleaned._validation = this.validateProfileData(cleaned);
    return cleaned;
  }

  /**
   * Sanity-check extracted fields. Returns { warnings: [{field, message, severity}], confidence: 0-1 }.
   * Detects obviously-wrong values (empty required fields, cross-field duplicates,
   * noise words leaking into fields, unreasonable lengths).
   */
  validateProfileData(data) {
    const warnings = [];
    const push = (field, message, severity = 'warning') =>
      warnings.push({ field, message, severity });

    const fullName = (data.fullName || '').trim();
    const jobTitle = (data.jobTitle || '').trim();
    const company = (data.company || '').trim();
    const location = (data.location || '').trim();

    // Required-field checks
    if (!fullName) push('fullName', 'Name was not extracted', 'error');
    if (!jobTitle) push('jobTitle', 'Job title was not extracted', 'error');
    if (!company) push('company', 'Company was not extracted', 'error');
    if (!location) push('location', 'Location was not extracted', 'warning');

    // Length sanity
    if (fullName && (fullName.length < 2 || fullName.length > 80)) {
      push('fullName', `Name length looks wrong (${fullName.length} chars)`);
    }
    if (jobTitle && jobTitle.length > 200) {
      push('jobTitle', 'Job title looks unusually long — may include headline noise');
    }
    if (company && company.length > 120) {
      push('company', 'Company looks unusually long');
    }
    if (location && location.length > 120) {
      push('location', 'Location looks unusually long');
    }

    // Field shape checks
    if (fullName && /\bat\b/i.test(fullName) && fullName.split(/\s+/).length > 5) {
      push('fullName', 'Name looks like a headline (contains "at ...")');
    }
    if (fullName && /\d/.test(fullName)) {
      push('fullName', 'Name contains digits — unlikely to be a real name');
    }
    if (location && /(connection|follower|mutual|·\s*\d+(st|nd|rd|th))/i.test(location)) {
      push('location', 'Location contains connection/follower noise');
    }
    if (jobTitle && /(connection|follower)/i.test(jobTitle)) {
      push('jobTitle', 'Job title contains connection/follower noise');
    }
    if (company && /(connection|follower|\d+\s*(followers|connections))/i.test(company)) {
      push('company', 'Company contains connection/follower noise');
    }

    // Cross-field duplicates
    const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
    if (eq(jobTitle, company)) push('jobTitle', 'Job title is identical to company');
    if (eq(jobTitle, fullName)) push('jobTitle', 'Job title is identical to name');
    if (eq(company, fullName)) push('company', 'Company is identical to name');
    if (eq(location, company)) push('location', 'Location is identical to company');

    // Confidence score: start at 1, subtract per issue
    const errorCount = warnings.filter(w => w.severity === 'error').length;
    const warnCount = warnings.filter(w => w.severity === 'warning').length;
    const confidence = Math.max(0, 1 - errorCount * 0.3 - warnCount * 0.1);

    return { warnings, confidence };
  }
}

// Initialize the extractor when script loads
const extractor = new LinkedInProfileExtractor();
window.linkedInContactExtractor = extractor;

// SPA navigation is handled by the persistent MutationObserver inside the class.
// The 'contactSaved' message is handled inside setupMessageListener() — no duplicate
// chrome.runtime.onMessage listener here to avoid double-handling.