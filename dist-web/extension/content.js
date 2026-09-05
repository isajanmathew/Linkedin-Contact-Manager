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
      button.className = 'linkedin-contact-saver-add-btn floating';
      document.body.appendChild(button);
      log('✅ Add Contact button injected as floating action pill');
    } else {
      button.className = 'linkedin-contact-saver-add-btn';
      log('✅ Add Contact button injected in profile card corner');
    }

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
   * Send progress update to side panel UI
   */
  sendProgress(message, type = 'loading', reloadSuggested = false) {
    try {
      chrome.runtime.sendMessage({
        action: 'profileExtractionProgress',
        message,
        type,
        reloadSuggested
      });
    } catch (_) { /* side panel might be closed */ }
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

      this.sendProgress('Connecting...', 'loading');

      try {
        await this.waitForProfileContent();
        log('✅ Profile content is ready, starting field extraction...');

        // 🔬 DIAGNOSTIC DUMP — helps identify current LinkedIn DOM
        this.dumpDomDiagnostics();

        this.sendProgress('Scanning page...', 'loading');
        await this.ensureExperienceSectionLoaded();

        // 🔬 DIAGNOSTIC DUMP — helps identify current LinkedIn DOM
        this.dumpDomDiagnostics();

        const fullName = this.extractFullName();
        this.sendProgress('Extracting details...', 'loading');
        let jobTitle = this.extractJobTitle();
        let company = this.extractCompany();

        // 1. If jobTitle contains "at Company" or "@ Company", e.g. "Software Engineer at Google"
        if (jobTitle) {
          const atMatch = jobTitle.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
          if (atMatch && atMatch[1] && atMatch[2]) {
            const potentialRole = atMatch[1].trim();
            const potentialCompany = atMatch[2].trim();
            if (this.isValidJobTitle(potentialRole)) {
              jobTitle = potentialRole;
              if (!company || company.toLowerCase() === potentialRole.toLowerCase()) {
                company = this.cleanCompanyName(potentialCompany);
              }
            }
          }
        }

        // 2. Clean up both fields
        if (jobTitle) jobTitle = this.cleanJobTitle(jobTitle, fullName);
        if (company) company = this.cleanCompanyName(company);

        // 3. Clean up full name if it was prepended to job title or company
        if (fullName) {
          const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const nameRegex = new RegExp('^' + escapedName + '\\s*', 'i');
          if (jobTitle) jobTitle = jobTitle.replace(nameRegex, '').trim();
          if (company) company = company.replace(nameRegex, '').trim();
        }

        const profileData = {
          fullName,
          jobTitle,
          company,
          location: this.extractLocation(),
          profileUrl: window.location.href,
          profilePicture: this.extractProfilePicture()
        };

        this.profileData = this.cleanProfileData(profileData);
        log('🎉 Final profile data extracted:', this.profileData);

        // Report status based on completeness
        if (!this.profileData.fullName) {
          this.sendProgress('Incomplete details', 'error', true);
        } else if (!this.profileData.jobTitle && !this.profileData.company) {
          this.sendProgress('Partial details', 'warning', true);
        } else {
          this.sendProgress('Profile loaded', 'ready', false);
        }

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
        this.sendProgress('Profile extraction failed. Try refreshing page.', 'error', true);
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

    this.sendProgress('Rendering...', 'loading');

    while (attempts < maxAttempts) {
      if (attempts > 0 && attempts % 4 === 0) {
        this.sendProgress(`Loading (${Math.min(attempts, maxAttempts)}/20)...`, 'loading');
      }

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
    this.sendProgress('Profile header took long to load. Checking fallback selectors...', 'loading', true);
  }

  async ensureExperienceSectionLoaded(options = {}) {
    const force = !!options.force;
    const originalY = window.scrollY;
    const maxScrolls = force ? 12 : 8;

    for (let i = 0; i < maxScrolls; i++) {
      if (i > 0 && i % 2 === 0) {
        this.sendProgress(`Scanning Experience section (pass ${i + 1}/${maxScrolls})...`, 'loading');
      }

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
    const rawTitle = (document.title || '')
      .replace(/^\(\d+\+?\)\s*/, '') // Strip notification badges like (1), (5), (99+)
      .replace(/\s*\|\s*LinkedIn.*$/i, '')
      .trim();

    if (!rawTitle || /^LinkedIn$/i.test(rawTitle)) return '';
    return this.cleanText(rawTitle);
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
    const name = this.extractNameFromProfileText();
    const root = this.getTopCardRoot();
    const headlineElement = root?.querySelector(
      'div[data-generated-suggestion-target], .text-body-medium.break-words, div.text-body-medium[data-field="headline"], .pv-text-details__left-panel > div.text-body-medium'
    ) || root?.querySelector('.text-body-medium');

    let headlineText = this.cleanText(headlineElement?.textContent || '');
    if (name && name.length >= 2 && headlineText.toLowerCase().startsWith(name.toLowerCase())) {
      headlineText = headlineText.slice(name.length).trim();
    }

    if (headlineText && this.isLikelyHeadlineLine(headlineText)) {
      return headlineText;
    }

    const lines = this.getTopCardTextLines();
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

    return headlineParts.join(' ').trim();
  }

  parseCompanyFromHeadline(headline) {
    const cleaned = this.cleanText(headline || '');
    if (!cleaned) return '';

    const name = this.extractNameFromProfileText();
    let text = cleaned;
    if (name && name.length >= 2) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('^' + escapedName + '\\s*', 'i'), '');
    }

    // Try finding "at Company" or "@ Company" in primary segment first
    const primary = text.split('|')[0].split('•')[0].split('—')[0].trim();
    const primaryMatch = primary.match(/(?:\bat\b|@)\s+([^|•·—,;]+)/i);
    if (primaryMatch && primaryMatch[1]) {
      const candidate = this.cleanCompanyName(primaryMatch[1].trim());
      if (candidate && this.isValidCompanyName(candidate)) {
        return candidate;
      }
    }

    // Then try finding it anywhere in the headline
    const atMatch = text.match(/(?:\bat\b|@)\s+([^|•·—,;]+)/i);
    if (atMatch && atMatch[1]) {
      const candidate = this.cleanCompanyName(atMatch[1].trim());
      if (candidate && this.isValidCompanyName(candidate)) {
        return candidate;
      }
    }

    return '';
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
    if (topCardCompany && this.isValidCompanyName(topCardCompany)) {
      return topCardCompany;
    }

    // Parse "at X" / "@ X" pattern inside the visible headline.
    const headline = this.extractHeadlineFromProfileText();
    const headlineCompany = this.parseCompanyFromHeadline(headline);
    if (headlineCompany) {
      return headlineCompany;
    }

    return '';
  }

  extractCompanyFromTopCardLinks() {
    const root = this.getTopCardRoot();
    const anchors = Array.from(root?.querySelectorAll('a') || []);
    const name = this.extractNameFromProfileText();
    const location = this.extractLocationFromProfileText();

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const text = this.cleanTopCardCompanyText(anchor.innerText || anchor.getAttribute('aria-label') || anchor.title || '');
      const isCompanyHref = /\/company\/|currentCompany|miniCompany/i.test(href);

      if (isCompanyHref && ![name, location].includes(text) && this.isValidTopCardCompany(text)) {
        return this.cleanCompanyName(text);
      }
    }

    // Top card experience button / right panel (e.g. current company button in top card):
    const rightPanelSelectors = [
      '.pv-text-details__right-panel a[href*="/company/"]',
      '.pv-text-details__right-panel button',
      '.pv-top-card--experience-list-item a',
      '.pv-top-card--experience-list a',
      'ul.pv-text-details__right-panel li:first-child a',
      'ul.pv-text-details__right-panel li:first-child'
    ];
    for (const sel of rightPanelSelectors) {
      try {
        const el = root?.querySelector(sel);
        if (el) {
          const text = this.cleanTopCardCompanyText(el.innerText || el.getAttribute('aria-label') || '');
          if (text && ![name, location].includes(text) && this.isValidTopCardCompany(text)) {
            return this.cleanCompanyName(text);
          }
        }
      } catch (_) {}
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
    if (/^(Contact info|Visit my website|Website|Personal website|Profile|Message|Connect|Follow|More|Save|Share|Open to work)$/i.test(text)) return false;
    if (/mutual connections?|followers?|connections?/i.test(text)) return false;
    if (this.isExperienceDateOrDurationLine(text) || this.isExperienceMetadataLine(text)) return false;
    if (this.isDescriptionSentence(text)) return false;
    return this.isValidCompanyName(text);
  }

  /**
   * Helper to retrieve clean visible text from an element while ignoring hidden/metadata tags
   */
  getVisibleText(element) {
    if (!element) return '';
    const ariaHidden = element.querySelector('span[aria-hidden="true"]');
    if (ariaHidden && ariaHidden.textContent && ariaHidden.textContent.trim()) {
      return this.cleanText(ariaHidden.textContent);
    }
    const cloned = element.cloneNode(true);
    cloned.querySelectorAll('.visually-hidden, [aria-hidden="false"], style, script').forEach(el => el.remove());
    return this.cleanText(cloned.innerText || cloned.textContent || '');
  }

  /**
   * Checks if candidate line is purely a date, duration or employment type
   */
  looksLikeDateOrDuration(text) {
    if (!text || typeof text !== 'string') return false;
    const cleaned = this.cleanText(text);
    if (!cleaned) return false;
    if (this.isExperienceDateOrDurationLine(cleaned)) return true;
    if (this.isExperienceMetadataLine(cleaned)) return true;
    if (/^\d{4}\s*[-–—]\s*(\d{4}|Present|Current)/i.test(cleaned)) return true;
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i.test(cleaned)) return true;
    if (/^\d+\s*yr(s)?(\s*\d*\s*mo(s)?)?$/i.test(cleaned)) return true;
    if (/^(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Permanent|Apprenticeship|Seasonal)$/i.test(cleaned)) return true;
    if (/^(Remote|Hybrid|On-site|Onsite)$/i.test(cleaned)) return true;
    return false;
  }

  /**
   * Retrieves the first sub-role item from a grouped multi-role experience card
   * (Ensures it is an actual role item with a date range, not a media or skill bullet)
   */
  getGroupedSubItem(experienceItem) {
    if (!experienceItem) return null;
    const nestedLists = Array.from(experienceItem.querySelectorAll('ul.pvs-list, ul[role="list"]'))
      .filter(list => !list.closest('.inline-show-more-text, [data-field="description"], [data-field="skills"], .show-more-less-text'));

    for (const list of nestedLists) {
      const subItems = Array.from(list.querySelectorAll(':scope > li, :scope > [role="listitem"], :scope > .pvs-list__paged-list-item'));
      for (const item of subItems) {
        const text = item.textContent || '';
        if (/\b(\d{4}|Present|Current)\b/i.test(text) && /\b(yr|mos?|month|year|Full-time|Part-time|Contract)\b/i.test(text)) {
          return item;
        }
      }
    }
    return null;
  }

  /**
   * Extract job title from Experience section, falling back to top-card headline only as last resort
   */
  extractJobTitle() {
    console.log('💼 Starting job title extraction...');
    const expSection = this.getExperienceSection();
    if (expSection) {
      const firstLi = expSection.querySelector('.pvs-list__outer-container > ul > li:first-child, ul.pvs-list > li:first-child, li.artdeco-list__item:first-child, .pvs-entity');
      if (firstLi) {
        const nestedUl = firstLi.querySelector('ul');
        if (nestedUl) {
          const subItem = nestedUl.querySelector('li');
          if (subItem) {
            const spans = Array.from(subItem.querySelectorAll('span[aria-hidden="true"]'))
              .map(s => s.textContent?.trim()).filter(Boolean);
            if (spans.length > 0) {
              const clean = this.cleanJobTitle(spans[0].split('·')[0].trim());
              if (clean && this.isValidJobTitle(clean)) {
                console.log(`  ✅ Found modern grouped job title: "${clean}"`);
                return clean;
              }
            }
          }
        } else {
          const spans = Array.from(firstLi.querySelectorAll('span[aria-hidden="true"]'))
            .map(s => s.textContent?.trim()).filter(Boolean);
          if (spans.length > 0) {
            const clean = this.cleanJobTitle(spans[0].split('·')[0].trim());
            if (clean && this.isValidJobTitle(clean)) {
              console.log(`  ✅ Found modern single job title: "${clean}"`);
              return clean;
            }
          }
        }
      }
    }

    const experienceItem = this.findFirstExperienceItem() || this.getFirstExperienceItem(this.getExperienceSection());

    if (experienceItem) {
      const subItem = this.getGroupedSubItem(experienceItem) || this.getFirstNestedExperienceRoleItem(experienceItem);
      const targetContainer = subItem || experienceItem;

      // 1. Direct bold title on the target item (excluding nested skills or sublists)
      const primaryTitle = targetContainer.querySelector(':scope > div span.mr1.t-bold span[aria-hidden="true"]') ||
                           targetContainer.querySelector('.display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]') ||
                           targetContainer.querySelector('.mr1.t-bold span[aria-hidden="true"]') ||
                           targetContainer.querySelector('.display-flex.align-items-center.mr1.t-bold') ||
                           targetContainer.querySelector('.mr1.t-bold') ||
                           targetContainer.querySelector('a[data-field="experience_title"]') ||
                           targetContainer.querySelector('h3 span[aria-hidden="true"]') ||
                           targetContainer.querySelector('h3');

      if (primaryTitle) {
        const text = this.getVisibleText(primaryTitle);
        if (text && !this.looksLikeDateOrDuration(text) && this.isValidJobTitle(text)) {
          const cleaned = this.cleanJobTitle(text);
          if (cleaned) {
            console.log(`  ✅ Found job title from primary bold element: "${cleaned}"`);
            return cleaned;
          }
        }
      }

      // 2. Fallback structured extraction
      const structured = this.extractJobTitleFromExperienceStructured(experienceItem);
      if (structured) {
        const cleaned = this.cleanJobTitle(structured);
        if (cleaned && this.isValidJobTitle(cleaned)) {
          console.log(`  ✅ Found job title from structured card: "${cleaned}"`);
          return cleaned;
        }
      }

      // 3. Line scan of target container
      const lines = this.getElementTextLines(targetContainer);
      for (const line of lines) {
        if (this.looksLikeDateOrDuration(line)) continue;
        const candidate = this.cleanExperienceJobTitleCandidate(line);
        if (candidate && this.isValidJobTitle(candidate)) {
          console.log(`  ✅ Found job title from line scan: "${candidate}"`);
          return candidate;
        }
      }
    }

    console.log('  ❌ Experience section did not yield job title');
    return '';
  }

  /**
   * Extract company strictly from Experience section
   */
  extractCompany() {
    console.log('🏢 Starting company extraction from Experience section...');
    const expSection = this.getExperienceSection();
    if (expSection) {
      const firstLi = expSection.querySelector('.pvs-list__outer-container > ul > li:first-child, ul.pvs-list > li:first-child, li.artdeco-list__item:first-child, .pvs-entity');
      if (firstLi) {
        // 1. Try company link (href contains /company/)
        const compLink = firstLi.querySelector('a[href*="/company/"]');
        if (compLink) {
          const span = compLink.querySelector('span[aria-hidden="true"]') || compLink;
          const text = span.textContent?.trim();
          if (text && !text.toLowerCase().includes('logo') && !text.toLowerCase().includes('company logo')) {
            const cand = this.cleanCompanyName(text.split('·')[0].trim());
            if (cand && !this.looksLikeDateOrDuration(cand) && this.isValidCompanyName(cand)) {
              console.log(`  ✅ Found modern company from company link: "${cand}"`);
              return cand;
            }
          }
        }

        const nestedUl = firstLi.querySelector('ul');
        if (nestedUl) {
          // Grouped role (e.g. Joe Preston at Intuit):
          const parentSpans = Array.from(firstLi.querySelectorAll('div.display-flex span[aria-hidden="true"]'))
            .map(s => s.textContent?.trim()).filter(Boolean);
          if (parentSpans.length > 0) {
            const cand = this.cleanCompanyName(parentSpans[0].split('·')[0].trim());
            if (cand && !this.looksLikeDateOrDuration(cand) && this.isValidCompanyName(cand)) {
              console.log(`  ✅ Found modern grouped company: "${cand}"`);
              return cand;
            }
          }
        } else {
          // Single role (e.g. Brett Frazer at Intuit, Adhithya Sriram at Lise Labs):
          const spans = Array.from(firstLi.querySelectorAll('span[aria-hidden="true"]'))
            .map(s => s.textContent?.trim()).filter(Boolean);
          if (spans.length >= 2) {
            for (let i = 1; i < Math.min(spans.length, 5); i++) {
              let cand = spans[i].split('·')[0].trim();
              cand = this.cleanCompanyName(cand);
              if (cand && !this.looksLikeDateOrDuration(cand) && this.isValidCompanyName(cand)) {
                console.log(`  ✅ Found modern single company: "${cand}"`);
                return cand;
              }
            }
          }
        }
      }
    }

    const experienceItem = this.findFirstExperienceItem() || this.getFirstExperienceItem(this.getExperienceSection());

    if (experienceItem) {
      const isGrouped = this.isGroupedExperienceItem(experienceItem) && !!this.getGroupedSubItem(experienceItem);

      // 1. Try company links / logos first (href contains /company/)
      const companyLinks = Array.from(experienceItem.querySelectorAll('a[href*="/company/"], a[href*="currentCompany"], a[href*="miniCompany"]'));
      for (const link of companyLinks) {
        const img = link.querySelector('img[alt]');
        if (img && img.getAttribute('alt')) {
          const alt = this.cleanExperienceCompanyCandidate(img.getAttribute('alt'));
          if (alt && !this.looksLikeDateOrDuration(alt) && this.isValidCompanyName(alt)) {
            console.log(`  ✅ Found company from logo image alt: "${alt}"`);
            return this.cleanCompanyName(alt);
          }
        }
        const text = this.getVisibleText(link);
        const candidate = this.cleanExperienceCompanyCandidate(text);
        if (candidate && !this.looksLikeDateOrDuration(candidate) && this.isValidCompanyName(candidate)) {
          console.log(`  ✅ Found company from company link: "${candidate}"`);
          return this.cleanCompanyName(candidate);
        }
      }

      // 2. If grouped, the company name sits at the top level in bold before the sub-list
      if (isGrouped) {
        const groupHeaders = [
          ':scope > div span.mr1.t-bold span[aria-hidden="true"]',
          ':scope > div .t-bold span[aria-hidden="true"]',
          ':scope > div .t-bold',
          ':scope > div.display-flex span.mr1.t-bold',
          ':scope h3 span[aria-hidden="true"]',
          ':scope h3'
        ];
        for (const sel of groupHeaders) {
          try {
            const el = experienceItem.querySelector(sel);
            if (el) {
              const text = this.getVisibleText(el);
              const candidate = this.cleanExperienceCompanyCandidate(text);
              if (candidate && !this.looksLikeDateOrDuration(candidate) && this.isValidCompanyName(candidate)) {
                console.log(`  ✅ Found grouped company name: "${candidate}"`);
                return this.cleanCompanyName(candidate);
              }
            }
          } catch (_) {}
        }
      }

      // 3. For single roles, company is in the subtitle span below the title (e.g. "Qualtrics · Full-time" or "Evolve with SOS")
      const subtitleSelectors = [
        'span.t-14.t-normal span[aria-hidden="true"]',
        'span[class*="t-14"][class*="t-normal"] span[aria-hidden="true"]',
        '.t-14.t-normal:not(.t-bold) span[aria-hidden="true"]',
        '.t-14.t-normal',
        'span.t-normal span[aria-hidden="true"]'
      ];

      for (const sel of subtitleSelectors) {
        const els = Array.from(experienceItem.querySelectorAll(sel));
        for (const el of els) {
          const text = this.getVisibleText(el);
          if (!text || this.looksLikeDateOrDuration(text)) continue;
          const parsed = this.parseExperienceCompanyFromLine(text);
          if (parsed && !this.looksLikeDateOrDuration(parsed) && this.isValidCompanyName(parsed)) {
            console.log(`  ✅ Found company from subtitle selector: "${parsed}"`);
            return this.cleanCompanyName(parsed);
          }
        }
      }

      // 4. Structured or text candidate extraction
      const parsedComp = this.extractCompanyFromExperienceText(experienceItem);
      if (parsedComp && !this.looksLikeDateOrDuration(parsedComp) && this.isValidCompanyName(parsedComp)) {
        console.log(`  ✅ Found company from experience text parser: "${parsedComp}"`);
        return this.cleanCompanyName(parsedComp);
      }

      // 5. Fallback DOM walk inside experience item
      const fallbackComp = this.extractCompanyFallback(experienceItem);
      if (fallbackComp && this.isValidCompanyName(fallbackComp)) {
        return this.cleanCompanyName(fallbackComp);
      }
    }

    console.log('  ❌ Experience section did not yield company name');
    return '';
  }

  /**
   * Clean company name text (remove extra info and formatting)
   */
  cleanCompanyName(company) {
    if (!company || typeof company !== 'string') return '';

    return company
      // Remove employment type indicators
      .replace(/\s*[·•|-]\s*(Permanent\s+Full-time|Permanent\s+Part-time|Permanent|Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Seasonal|Remote|Hybrid|On-site|Onsite).*$/i, '')

      // Remove employee count and company info
      .replace(/\s*\([\d,]+\+?\s*employees?\)/i, '')
      .replace(/\s*\(.*\)$/, '')

      // Remove duration and dates
      .replace(/\s*[·•]\s*\d+\s*yr(s)?.*$/i, '')
      .replace(/\s*\d+\s*yr(s)?\s*\d*\s*mo(s)?.*$/i, '')
      .replace(/\s*\d{4}\s*[-–—].*$/i, '')

      // Remove bullets and separators
      .replace(/\s*•.*$/, '')
      .replace(/\s*\|.*$/, '')
      .replace(/\s*·.*$/, '')

      // Remove common prefixes
      .replace(/^company:\s*/i, '')
      .replace(/^at\s+/i, '')

      // Remove link text artifacts
      .replace(/\s*link$/i, '')
      .replace(/\s*page$/i, '')

      // Clean up whitespace and punctuation
      .replace(/\s*\.\s*$/, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s-]+|[\s-]+$/g, '')
      .trim();
  }

  getFirstExperienceItem(expSection) {
    if (!expSection) return null;
    const items = Array.from(expSection.querySelectorAll('li.artdeco-list__item, li.pvs-list__item, li.pvs-list__paged-list-item, [data-field="experience"] li'));
    if (items.length > 0) return items[0];
    const fallbackItems = Array.from(expSection.querySelectorAll('ul > li'));
    return fallbackItems.length > 0 ? fallbackItems[0] : null;
  }

  extractJobTitleFromTopCardHeadline() {
    return this.parseJobTitleFromHeadline(this.extractHeadlineFromProfileText());
  }

  parseJobTitleFromHeadline(headline) {
    const cleaned = this.cleanText(headline || '');
    if (!cleaned || !this.isLikelyHeadlineLine(cleaned)) return '';

    const name = this.extractNameFromProfileText();
    let titlePart = cleaned;
    if (name && name.length >= 2) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      titlePart = titlePart.replace(new RegExp('^' + escapedName + '\\s*', 'i'), '');
    }

    const segments = titlePart
      .split(/[|•·—;]/)
      .map(s => this.cleanText(s))
      .filter(Boolean);

    // Prefer segment that contains explicit role indicators or "at"
    for (const segment of segments) {
      if (/^[\p{Emoji}\s]*\b(MOVE|JOIN|HELPING|BUILDING|CREATING|PASSIONATE|OPEN TO)\b/iu.test(segment)) {
        continue;
      }
      const atMatch = segment.match(/^(.+?)\s+(?:at|@)\s+.+$/i);
      const roleText = atMatch?.[1] || segment;
      const commaMatch = roleText.match(/^([A-Za-z\s&/-]+?),\s+[A-Za-z0-9\s&]+$/);
      const candidateText = commaMatch?.[1] || roleText;
      const candidate = this.cleanJobTitle(candidateText, name);

      if (candidate && this.isLikelyJobTitle(candidate) && this.isValidJobTitle(candidate)) {
        return candidate;
      }
    }

    // Fallback: check all segments
    for (const segment of segments) {
      const atMatch = segment.match(/^(.+?)\s+(?:at|@)\s+.+$/i);
      const candidate = this.cleanJobTitle(atMatch?.[1] || segment, name);
      if (candidate && this.isLikelyProfessionalTitle(candidate) && this.isValidJobTitle(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  parseCompanyFromHeadline(headline) {
    const cleaned = this.cleanText(headline || '');
    if (!cleaned || !this.isLikelyHeadlineLine(cleaned)) return '';

    const segments = cleaned.split(/[|•·—]/).map(s => this.cleanText(s)).filter(Boolean);
    for (const segment of segments) {
      const atMatch = segment.match(/\b(?:at|@)\s+([^,]+)/i);
      if (atMatch?.[1]) {
        const candidate = this.cleanCompanyName(atMatch[1]);
        if (candidate && this.isValidCompanyName(candidate)) {
          return candidate;
        }
      }
    }

    return '';
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
      ? (this.getFirstNestedExperienceRoleItem(experienceItem) || experienceItem)
      : experienceItem;

    const candidates = this.getExperienceTitleCandidates(roleItem);
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

    const lines = this.getExperienceHeaderLines(element).slice(0, 10);
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
      ':scope div[class*="bold"] span[aria-hidden="true"]',
      ':scope span[class*="bold"] span[aria-hidden="true"]',
      ':scope a[href*="/details/experience/"] span[aria-hidden="true"]',
      ':scope a[data-field="experience_title"]',
      ':scope h3 span[aria-hidden="true"]',
      ':scope h3',
      ':scope h4',
      ':scope strong'
    ];

    for (const selector of selectors) {
      try {
        for (const node of element.querySelectorAll(selector)) {
          // Reject any bold candidate that is part of description, skills, or extra noise
          if (node.closest('.inline-show-more-text, .feed-shared-inline-show-more-text, [data-field="description"], [data-field="skills"], .show-more-less-text, .pvs-list__outer-container')) {
            continue;
          }
          const text = this.cleanExperienceJobTitleCandidate(node.textContent || '');
          if (text) candidates.push(text);
        }
      } catch (e) { /* invalid selector fallback */ }
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

    // A grouped experience item MUST have nested sub-role items with distinct dates
    const roleItem = this.getFirstNestedExperienceRoleItem(experienceItem);
    if (!roleItem) return false;

    const lines = this.getExperienceHeaderLines(experienceItem).slice(0, 6);
    if (lines.some(line => /^total\s+duration\s+/i.test(line))) return true;

    // Check if there are at least multiple role listitems with dates
    const nestedLists = Array.from(experienceItem.querySelectorAll('ul.pvs-list, ul[role="list"]'))
      .filter(list => !list.closest('.inline-show-more-text, [data-field="description"], [data-field="skills"], .pvs-list__outer-container'));

    for (const list of nestedLists) {
      const items = Array.from(list.querySelectorAll(':scope > li, :scope > [role="listitem"]'));
      const itemsWithDates = items.filter(it => {
        const textLines = this.getExperienceHeaderLines(it);
        return textLines.some(l => this.isExperienceDateOrDurationLine(l)) || !!it.querySelector('a[href*="/details/experience/"]');
      });
      if (itemsWithDates.length >= 1) return true;
    }

    return false;
  }

  getFirstNestedExperienceRoleItem(experienceItem) {
    if (!experienceItem) return null;

    // Look for nested sub-role lists (excluding description bullet lists, skills lists, and media)
    const nestedLists = Array.from(experienceItem.querySelectorAll('ul.pvs-list, ul[role="list"], ul'))
      .filter(list => {
        if (list.closest('.inline-show-more-text, .feed-shared-inline-show-more-text, [data-field="description"], [data-field="skills"], .show-more-less-text, .pvs-list__outer-container')) {
          return false;
        }
        const parentListItem = list.closest('li, [role="listitem"]');
        return parentListItem && parentListItem !== list && experienceItem.contains(parentListItem);
      });

    for (const list of nestedLists) {
      const directItems = Array.from(list.children).flatMap(child => {
        if (child.matches('li, [role="listitem"], .pvs-list__paged-list-item')) return [child];
        return Array.from(child.querySelectorAll(':scope > li, :scope > [role="listitem"], :scope > .pvs-list__paged-list-item'));
      });

      // A genuine sub-role MUST have its own date range or experience link
      const validRole = directItems.find(child => {
        if (child.closest('.inline-show-more-text, [data-field="description"], [data-field="skills"]')) return false;
        const textLines = this.getExperienceHeaderLines(child);
        return textLines.some(l => this.isExperienceDateOrDurationLine(l)) || !!child.querySelector('a[href*="/details/experience/"]');
      });

      if (validRole) {
        return validRole;
      }
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
    const candidateLower = cleaned.toLowerCase();

    // Reject exact match with company name
    if (cleanedCompany && candidateLower === cleanedCompany) return false;

    // Reject if candidate is a common corporate entity name matching company
    if (cleanedCompany && (candidateLower.endsWith(' inc') || candidateLower.endsWith(' llc') || candidateLower.endsWith(' corp'))) {
      if (candidateLower.includes(cleanedCompany)) return false;
    }

    return this.isValidJobTitle(cleaned);
  }

  extractJobTitleFromExperienceText(experienceItem) {
    const company = this.extractCompanyFromExperienceLinks(experienceItem) || this.extractCompanyFromExperienceText(experienceItem);
    const hasNestedList = this.hasNestedExperienceList(experienceItem);

    if (hasNestedList) {
      const nestedRoleItem = this.getFirstNestedExperienceRoleItem(experienceItem);
      if (nestedRoleItem) {
        const nestedLines = this.getExperienceHeaderLines(nestedRoleItem).slice(0, 6);
        for (const line of nestedLines) {
          const candidate = this.cleanExperienceJobTitleCandidate(line);
          if (this.isValidExperienceJobTitle(candidate, company)) return candidate;
        }
      }
    }

    const lines = this.getExperienceHeaderLines(experienceItem).slice(0, 6);
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
  cleanJobTitle(jobTitle, nameOverride = '') {
    if (!jobTitle) return '';

    const cleanedRaw = this.cleanText(jobTitle);
    if (!cleanedRaw || this.isExperienceDateOrDurationLine(cleanedRaw) || this.isExperienceMetadataLine(cleanedRaw)) {
      return '';
    }

    let cleaned = jobTitle;
    let fullName = nameOverride || this.extractFullName() || this.extractNameFromProfileText() || '';
    fullName = fullName.replace(/^\(\d+\+?\)\s*/, '').trim();

    if (fullName && fullName.length >= 2) {
      // 1. Exact full name match at start
      const escapedFull = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      cleaned = cleaned.replace(new RegExp('^' + escapedFull + '\\s*', 'i'), '');

      // 2. Loose match for first + last name parts at start
      const nameParts = fullName.split(/\s+/).filter(p => p.length >= 2);
      if (nameParts.length > 1) {
        const firstNameEscaped = nameParts[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lastNameEscaped = nameParts[nameParts.length - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const looseNamePattern = new RegExp('^' + firstNameEscaped + '.*?' + lastNameEscaped + '\\s*', 'i');
        cleaned = cleaned.replace(looseNamePattern, '');
      }
    }

    cleaned = cleaned
      .replace(/^at\s+/i, '')                    // Remove "at Company"
      .replace(/^company:\s*/i, '')              // Remove "Company: Name"
      .replace(/\s*·\s*(Permanent\s+Full-time|Permanent\s+Part-time|Permanent|Full-time|Part-time|Contract|Freelance|Internship|Self-employed).*$/i, '') // Remove employment type
      .replace(/\s*-\s*(Permanent\s+Full-time|Permanent\s+Part-time|Permanent|Full-time|Part-time|Contract|Freelance|Internship|Self-employed).*$/i, '') // Remove employment type with dash
      .replace(/(?:Permanent\s+Full-time|Permanent\s+Part-time|Permanent|Full-time|Part-time|Contract|Freelance|Internship|Self-employed).*$/i, '') // Strip glued employment types
      .replace(/\s+at\s+.*$/i, '')               // Remove " at Company Name"
      .replace(/\s*•.*$/, '')                    // Remove bullet points and following text
      .replace(/\s*\|.*$/, '')                   // Remove pipe separators and following text
      .replace(/\s*·.*$/, '')                    // Remove middle dots and following text
      .replace(/\s*\([^)]*\)$/, '')              // Remove trailing parenthetical info only
      .replace(/\s*\d+\s*yr(s)?.*$/i, '')        // Remove duration like "2 yrs 3 mos"
      .replace(/\s*\d{4}\s*[-–—].*$/i, '')       // Remove date ranges
      .replace(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*\d{0,4}.*$/i, '') // Remove glued date month fragments
      .replace(/\s+/g, ' ')                      // Replace multiple spaces with single space
      .trim();

    if (!cleaned || this.isExperienceDateOrDurationLine(cleaned) || this.isExperienceMetadataLine(cleaned)) {
      return '';
    }

    return cleaned;
  }



  /**
   * Find the first experience item on the page (shared by job title and company extraction)
   */
  findFirstExperienceItem() {
    const experienceSection = this.getExperienceSection();
    if (experienceSection) {
      const directItem = this.findFirstDirectExperienceItem(experienceSection);
      if (directItem) {
        console.log('  ✅ Found top-level experience item via section list parsing');
        return directItem;
      }
    }

    const selectors = [
      '#experience ~ .pvs-list__outer-container > ul.pvs-list > li:first-child',
      '#experience ~ div ul.pvs-list > li:first-child',
      '#experience ~ div li.artdeco-list__item:first-child',
      '#experience + div li.artdeco-list__item:first-child',
      '#experience ~ * li:first-child',
      'section:has(#experience) ul.pvs-list > li:first-child',
      'section:has(#experience) > div > ul > li:first-child',
      '[data-field="experience"] .pvs-list__paged-list-item:first-child',
      'section[data-section="experience"] li:first-child',
      'section:has(#experience) li:first-child'
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
      const item = modernExperienceSection.querySelector('ul.pvs-list > li:first-child, ul li:first-child, li:first-child, [role="listitem"]');
      if (item) {
        console.log('  ✅ Found experience item via heading-based LinkedIn fallback');
        return item;
      }
    }

    // Text-based fallback: find section containing "Experience" heading
    const allSections = document.querySelectorAll('section, .artdeco-card, .pv-profile-card, div[data-view-name*="profile-card"]');
    for (const section of allSections) {
      const heading = section.querySelector('h2, h3, [id="experience"], [id*="experience"], .pvs-header__container');
      if (heading && /\bexperience\b/i.test(heading.textContent)) {
        const item = section.querySelector('ul.pvs-list > li:first-child, li:first-child, ul > div:first-child, [role="listitem"]');
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
    const expAnchor = document.getElementById('experience') || document.querySelector('[id="experience"], [id*="experience"]');
    if (expAnchor) {
      const container = expAnchor.closest('section, .artdeco-card, .pv-profile-card, div[data-view-name*="profile-card"], .pvs-profile-card') || expAnchor.parentElement;
      if (container) return container;
    }

    const selectors = [
      'section:has(#experience)',
      '[data-field="experience"]',
      'section[data-section="experience"]'
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch (e) { /* :has() may fail in some contexts */ }
    }

    return this.findProfileSectionByHeading('Experience');
  }

  findFirstDirectExperienceItem(section) {
    if (!section) return null;

    // Find the primary top-level list of experiences
    const listCandidates = Array.from(section.querySelectorAll('ul.pvs-list, div.pvs-list__outer-container > ul, ul[role="list"], ul'))
      .filter(list => !list.closest('.inline-show-more-text, [data-field="description"], [data-field="skills"], .show-more-less-text'));

    for (const list of listCandidates) {
      const parentListItem = list.closest('li, [role="listitem"]');
      if (parentListItem && section.contains(parentListItem)) continue; // skip nested lists inside an experience card

      const directItems = Array.from(list.children).filter(child =>
        child.matches('li, [role="listitem"], .pvs-list__paged-list-item, .artdeco-list__item')
      );

      if (directItems.length > 0) {
        return directItems[0];
      }
    }

    const fallbackItems = Array.from(section.querySelectorAll('.pvs-list__paged-list-item, li.artdeco-list__item, [role="listitem"], li'));
    // Filter out items that are nested inside another list item
    const rootItems = fallbackItems.filter(item => {
      const parentItem = item.parentElement?.closest('.pvs-list__paged-list-item, li.artdeco-list__item, [role="listitem"]');
      return !parentItem;
    });

    return rootItems.length > 0 ? rootItems[0] : (fallbackItems[0] || null);
  }

  isLikelyExperienceCard(candidate) {
    if (!candidate) return false;
    const directText = this.cleanText(candidate.textContent || '');
    if (!directText || directText.length < 3) return false;
    if (/^(Experience|Show all\s*\d*\s*experiences?)$/i.test(directText)) return false;

    const hasCompanyLink = !!candidate.querySelector('a[href*="/company/"], a[href*="currentCompany"], a[href*="miniCompany"]');
    const hasRoleTitle = !!candidate.querySelector('.t-bold, h3, a[data-field="experience_title"]');
    const hasDates = /\b(\d{4}|Present|Current)\b/i.test(directText);

    return hasCompanyLink || hasRoleTitle || hasDates;
  }

  findProfileSectionByHeading(headingText) {
    const normalizedHeading = headingText.toLowerCase();
    const main = document.querySelector('main') || document.body;
    const candidates = main.querySelectorAll('h1, h2, h3, span, div.pvs-header__container, .artdeco-card__header');

    for (const candidate of candidates) {
      const text = this.cleanText(candidate.textContent).toLowerCase();
      if (!text.includes(normalizedHeading)) continue;

      const container = candidate.closest('section, .artdeco-card, .pv-profile-card, div[data-view-name*="profile-card"], .pvs-profile-card');
      if (container) return container;

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

  getExperienceHeaderLines(element) {
    if (!element) return [];
    try {
      const clone = element.cloneNode(true);
      // Remove descriptions, bullet lists, skills, media, buttons, and "see more" elements
      const noiseSelectors = [
        '.inline-show-more-text',
        '.feed-shared-inline-show-more-text',
        '[data-field="description"]',
        '[data-field="skills"]',
        '.pvs-list__outer-container',
        '.show-more-less-text',
        'button',
        '.artdeco-button',
        '.pvs-navigation__icon',
        'svg',
        '.visually-hidden'
      ];
      noiseSelectors.forEach(sel => {
        clone.querySelectorAll(sel).forEach(el => el.remove());
      });
      return this.getElementTextLines(clone);
    } catch (e) {
      return this.getElementTextLines(element);
    }
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

  /**
   * Check if line is a date or duration string in Experience section
   */
  isExperienceDateOrDurationLine(text) {
    if (!text) return false;
    const cleaned = this.cleanText(text);
    if (!cleaned) return false;

    // Month abbreviation or month name pattern at start
    const monthStartPattern = /^(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)(\s+\d{4}|\s*[-–—]|\s*·|\s*$|\s+Present|\s+Current)/i;
    if (monthStartPattern.test(cleaned)) return true;

    const datePatterns = [
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{4}/i,
      /^\d{4}\s*[-–—]\s*(\d{4}|Present|Current)/i,
      /^\d{4}$/,
      /^\d+\s*yr(s)?(\s+\d+\s*mo(s)?)?/i,
      /^\d+\s*mo(s)?/i,
      /^(Present|Current)$/i,
      /^\d{4}\s*[-–—]\s*Present/i,
      /\b\d+\s*yrs?\b/i,
      /\b\d+\s*mos?\b/i
    ];
    return datePatterns.some(pattern => pattern.test(cleaned));
  }

  isExperienceMetadataLine(text) {
    if (!text) return true;
    const cleaned = this.cleanText(text);
    if (!cleaned) return true;

    const metadataPatterns = [
      /^(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Temporary|Seasonal|Permanent|Permanent\s+Full-time|Permanent\s+Part-time)$/i,
      /^·?\s*(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Temporary|Seasonal|Permanent|Permanent\s+Full-time|Permanent\s+Part-time)$/i,
      /^(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)/i,
      /^\d{4}\s*[-–—]\s*(\d{4}|Present|Current)$/i,
      /^\d+\s*yr(s)?(\s+\d+\s*mo(s)?)?$/i,
      /^\d+\s*mo(s)?$/i,
      /^Present$/i,
      /^(Show all|See more|See less|Experience|Company name|Location|Duration)$/i
    ];

    return metadataPatterns.some(pattern => pattern.test(cleaned)) ||
      this.isExperienceDateOrDurationLine(cleaned) ||
      this.isTopCardNoiseLine(cleaned) ||
      this.isConnectionDegreeText(cleaned) ||
      this.isLikelyLocation(cleaned);
  }

  isLikelyJobTitle(text) {
    const cleaned = this.cleanText(text || '');
    if (!cleaned || cleaned.length < 2 || cleaned.length > 140) return false;

    // Check for standard role keywords or phrases
    const rolePattern = /\b(Head\s+of|Director|Manager|Lead|Senior|Junior|Principal|Staff|Distinguished|Chief|Executive|Specialist|Analyst|Engineer|Engineering|Developer|Development|Architect|Architecture|Consultant|Consulting|Strategist|Strategy|Coordinator|Producer|President|VP|Vice\s+President|SVP|EVP|AVP|Founder|Co-Founder|Co\s+Founder|CEO|CTO|CFO|COO|CMO|CPO|CRO|CIO|CISO|Associate|Assistant|Officer|Recruiter|Talent|Scientist|Researcher|Research|Owner|Co-Owner|Partner|Advisor|Programmer|Coder|DevOps|SRE|QA|SDET|Tester|Full\s*Stack|Frontend|Front-End|Backend|Back-End|Designer|Design|Writer|Copywriter|Author|Editor|Journalist|Creator|Artist|Animator|Videographer|Photographer|Account\s+Executive|Sales|Marketer|Marketing|Growth|Customer\s+Success|Support|Representative|Agent|Broker|Trader|Investor|Counsel|Attorney|Lawyer|Accountant|Auditor|Economist|Professor|Instructor|Teacher|Lecturer|Fellow|Intern|Apprentice|Doctor|Physician|Surgeon|Nurse|Therapist|Scrum\s+Master|Product\s+Owner|Member\s+of\s+Technical\s+Staff)\b/i;
    if (rolePattern.test(cleaned)) return true;

    // Level prefix + any word (e.g. "Senior Front End", "Staff Infrastructure", "Lead Backend")
    if (/^(Senior|Junior|Staff|Principal|Lead|Chief|Associate|Assistant|Managing|Executive|Global|Regional|National|Head)\s+/i.test(cleaned)) {
      return true;
    }

    return false;
  }

  isExplicitCompanyName(text) {
    const cleaned = this.cleanText(text || '');
    if (!cleaned) return false;

    // Explicit corporate structure or entity terms
    const corpPattern = /\b(Inc\.?|LLC|Ltd\.?|Corp\.?|Corporation|GmbH|Pty|Co\.?|Group|Holdings|Partners|Solutions|Technologies|Tech|Labs|Studio|Studios|Agency|Ventures|Capital|Systems|Bank|Financial|Services|Global|Interactive|Software|Media|Enterprises|Industries|Consulting|Works|Network|Networks|International)\b/i;
    return corpPattern.test(cleaned);
  }

  isDescriptionSentence(text) {
    const cleaned = this.cleanText(text || '');
    if (!cleaned) return false;

    // Ends with colon or is a section label (e.g. "Major projects include:", "Responsibilities:")
    if (/:$/.test(cleaned)) return true;
    if (/^(Major\s+)?(projects?|achievements?|responsibilities|overview|summary|highlights?|skills?|scope|initiatives?)\s*(include|includes|including)?\s*[:\-]?$/i.test(cleaned)) return true;

    // Starts with bullet point or dash list marker
    if (/^[•▪▫*–—]\s*/.test(cleaned)) return true;

    // Ends with full sentence punctuation
    if (/[.!?]$/.test(cleaned) && cleaned.split(/\s+/).length > 3) return true;

    // Internal sentence punctuation
    if (/[.!?]\s+[A-Z]/.test(cleaned)) return true;

    // Narrative/bio verbs and descriptive phrases
    const proseVerbs = /\b(chasing|building|leading|managing|creating|driving|helping|working|developing|providing|spearheaded|responsible|raised|gave|designing|architecting|curating|overseeing|focused\s+on|passionate\s+about|looking\s+for|skilled\b|experienced\b|proven\b|demonstrated\b|a\s+decade\s+of|with\s+a\s+bigger\s+team|fewer\s+excuses|major\s+projects|include:|includes:|including:)\b/i;
    if (proseVerbs.test(cleaned)) return true;

    // Unusually long without standard title separators
    if (cleaned.length > 80 && !/[|•·\-]/.test(cleaned)) return true;

    return false;
  }

  isValidExperienceCompanyName(text) {
    const cleaned = this.cleanExperienceCompanyCandidate(text);
    if (!cleaned || cleaned.length < 2 || cleaned.length > 150) return false;
    if (/:$/.test(cleaned)) return false;
    if (/^(Major\s+)?(projects?|responsibilities|achievements|skills|highlights|overview|summary|duties)\b/i.test(cleaned)) return false;
    if (this.isExperienceMetadataLine(cleaned)) return false;
    if (this.isDescriptionSentence(cleaned)) return false;
    if (/^(Current company|Current position)$/i.test(cleaned)) return false;

    // Reject standalone month names or date strings
    if (/^(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)$/i.test(cleaned)) return false;

    return this.isValidCompanyName(cleaned);
  }

  extractCompanyFromExperienceLinks(experienceItem) {
    const companyLinks = Array.from(experienceItem?.querySelectorAll(
      'a[href*="/company/"], a[href*="currentCompany"], a[href*="miniCompany"], a[data-field*="company"]'
    ) || []).filter(link => !link.closest('.inline-show-more-text, [data-field="description"], [data-field="skills"], .show-more-less-text'));

    for (const link of companyLinks) {
      // 1. Try image alt or aria-label first (which are typically clean: "Microsoft logo", "Google")
      const imgAlts = Array.from(link.querySelectorAll('img')).map(img => img.getAttribute('alt') || '');
      for (const alt of imgAlts) {
        const candidate = this.cleanExperienceCompanyCandidate(alt);
        if (candidate && this.isValidExperienceCompanyName(candidate)) {
          return candidate;
        }
      }

      const ariaLabel = link.getAttribute('aria-label') || link.getAttribute('title') || '';
      if (ariaLabel) {
        const candidate = this.cleanExperienceCompanyCandidate(ariaLabel);
        if (candidate && this.isValidExperienceCompanyName(candidate)) {
          return candidate;
        }
      }

      // 2. Try text lines inside link, skipping any line that is a date or metadata
      const lines = this.getElementTextLines(link);
      for (const line of lines) {
        const candidate = this.cleanExperienceCompanyCandidate(line);
        if (candidate && this.isValidExperienceCompanyName(candidate)) {
          return candidate;
        }
      }
    }

    return '';
  }

  extractCompanyFromExperienceText(experienceItem) {
    const lines = this.getExperienceHeaderLines(experienceItem).slice(0, 10);
    if (!lines.length) return '';

    const hasNestedList = this.isGroupedExperienceItem(experienceItem);

    if (hasNestedList) {
      // Grouped Experience cards are usually:
      // Company Name / Duration / nested role title / dates...
      const firstLine = this.cleanExperienceCompanyCandidate(lines[0]);
      if (firstLine && this.isValidExperienceCompanyName(firstLine)) {
        return firstLine;
      }
    }

    // For single-role cards (or fallback):
    // Single-role cards are usually:
    // Line 0: Job Title
    // Line 1: Company · Employment type
    // Line 2: Dates / Duration
    // Line 3: Location
    for (const line of lines.slice(1, 6)) {
      const splitCompany = this.parseExperienceCompanyFromLine(line);
      if (splitCompany && this.isValidExperienceCompanyName(splitCompany)) return splitCompany;

      const employmentMatch = line.match(/^(.+?)\s*[·•|-]\s*(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Temporary|Seasonal|Permanent|Permanent\s+Full-time|Permanent\s+Part-time)\b/i);
      if (employmentMatch?.[1]) {
        const candidate = this.cleanExperienceCompanyCandidate(employmentMatch[1]);
        if (candidate && this.isValidExperienceCompanyName(candidate)) {
          return candidate;
        }
      }

      const candidate = this.cleanExperienceCompanyCandidate(line);
      if (candidate && this.isValidExperienceCompanyName(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  parseExperienceCompanyFromLine(line) {
    const cleaned = this.cleanText(line || '');
    if (!cleaned) return '';

    // "Title at Company"
    const atMatch = cleaned.match(/^.+?\s+(?:at|@)\s+(.+)$/i);
    if (atMatch?.[1]) {
      const candidate = this.cleanExperienceCompanyCandidate(atMatch[1]);
      if (candidate && this.isValidExperienceCompanyName(candidate)) {
        return candidate;
      }
    }

    // "Company · Employment Type" or "Role · Company"
    const parts = cleaned.split(/[·•|]/).map(part => this.cleanText(part)).filter(Boolean);
    if (parts.length >= 2) {
      // First try parts[0] (standard layout: "Company · Employment Type")
      const candidate0 = this.cleanExperienceCompanyCandidate(parts[0]);
      if (candidate0 && this.isValidExperienceCompanyName(candidate0)) {
        return candidate0;
      }
      // Then try parts[1] (alternative layout: "Role · Company")
      const candidate1 = this.cleanExperienceCompanyCandidate(parts[1]);
      if (candidate1 && this.isValidExperienceCompanyName(candidate1)) {
        return candidate1;
      }
    } else if (parts.length === 1) {
      const candidate = this.cleanExperienceCompanyCandidate(parts[0]);
      if (candidate && this.isValidExperienceCompanyName(candidate)) {
        return candidate;
      }
    }

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

      if (this.isValidCompanyName(text)) {
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
    if (!text || typeof text !== 'string') return false;
    const cleaned = this.cleanText(text);

    if (cleaned.length < 2) {
      return false;
    }

    // Company names should be reasonable length
    if (cleaned.length > 150) {
      return false;
    }

    if (/:$/.test(cleaned) || /^(Major\s+)?(projects?|responsibilities|achievements|skills|highlights|overview|summary|duties)\b/i.test(cleaned)) {
      return false;
    }

    if (this.isDescriptionSentence(cleaned)) {
      return false;
    }

    // Reject if it's just employment type or workplace type
    const employmentTypePatterns = [
      /^(Full-time|Part-time|Contract|Freelance|Internship|Self-employed|Apprenticeship|Temporary|Seasonal|Permanent|Permanent\s+Full-time|Permanent\s+Part-time)$/i,
      /^(Remote|Hybrid|On-site|Onsite)$/i,
      /^·\s*(Full-time|Part-time|Contract|Freelance|Internship|Remote|Hybrid)$/i
    ];

    for (const pattern of employmentTypePatterns) {
      if (pattern.test(cleaned)) {
        return false;
      }
    }

    // Reject if it's just a date or duration
    if (this.isExperienceDateOrDurationLine(cleaned)) {
      return false;
    }

    // Reject UI elements
    const uiElements = [
      /^(Message|Connect|Follow|More|Experience|Show all|See less|See more|Activity|Interests)$/i,
      /^(Edit|Delete|Add|Remove)$/i,
      /^Company name$/i,
      /^Contact info$/i,
      /^Open to work$/i
    ];

    for (const pattern of uiElements) {
      if (pattern.test(cleaned)) {
        return false;
      }
    }

    // Reject connection degree text
    if (this.isConnectionDegreeText(cleaned)) {
      return false;
    }

    // Reject pure locations
    if (this.isLikelyLocation(cleaned)) {
      return false;
    }

    return true;
  }

  /**
   * Relaxed validation for fallback company extraction
   */
  isValidCompanyNameRelaxed(text) {
    return this.isValidCompanyName(text);
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

    if (/:$/.test(text) || /^(Major\s+)?(projects?|responsibilities|achievements|skills|highlights|overview|summary|duties)\b/i.test(text)) {
      console.log('    Validation failed: Looks like a section header or description line');
      return false;
    }

    // Reject bio / responsibility description sentences
    if (this.isDescriptionSentence(text)) {
      console.log('    Validation failed: Looks like a description/bio sentence');
      return false;
    }

    // Reject if it's a date or date range or month name
    if (this.isExperienceDateOrDurationLine(text) || this.isExperienceMetadataLine(text)) {
      console.log('    Validation failed: Text is date or metadata line');
      return false;
    }

    const dateOnlyPatterns = [
      /^(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\b/i,
      /^\d{4}\s*[-–—]\s*(\d{4}|Present|Current)$/i,
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i,
      /^\d+\s*yr(s)?\s*\d*\s*mo(s)?$/i,
      /^(Present|Current|Location|Duration)$/i
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

    // Reject if text is purely an explicit company name with corporate suffix
    if (this.isExplicitCompanyName(text) && !this.isLikelyJobTitle(text)) {
      console.log('    Validation failed: Looks like explicit company name');
      return false;
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
   * Synchronous / primary extraction helper returning normalized profile data
   */
  extractData() {
    return {
      fullName: this.extractFullName ? this.extractFullName() : this.extractName(),
      jobTitle: this.extractJobTitle(),
      company: this.extractCompany(),
      location: this.extractLocation(),
      profileUrl: window.location.href ? window.location.href.split('?')[0] : '',
      imageUrl: this.extractProfilePicture ? this.extractProfilePicture() : (this.extractProfileImage ? this.extractProfileImage() : '')
    };
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