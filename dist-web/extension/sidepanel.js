/**
 * Side panel UI. Every read comes from the local store via the service worker;
 * saving never blocks on the network.
 */

class SidePanelManager {
  constructor() {
    this.isLoading = false;
    this.currentProfileData = {};
    this.existingContactId = null;
    this.isExistingContactLoaded = false;
    this.isManualRefreshing = false;
    this.tagOptions = [];
    this.selectedTags = [];
    this.defaultQuarterlyReminder = true;
    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.setupMessageListener();
    await this.loadSyncSettings();
    await this.loadTagOptions();
    await this.refreshSyncStatus();
    this.updateCadencePreview();
    await this.checkCurrentPage();
  }

  /* ----------------------------- wiring ----------------------------- */

  setupEventListeners() {
    document.getElementById('configToggle').addEventListener('click', () => {
      this.toggleConfiguration();
    });

    document.getElementById('saveConnection')?.addEventListener('click', () => {
      this.saveConnection();
    });

    document.getElementById('syncNow')?.addEventListener('click', () => {
      this.syncNow();
    });

    document.getElementById('defaultQuarterlyReminder')?.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      this.defaultQuarterlyReminder = enabled;
      await chrome.runtime.sendMessage({
        action: 'setDefaultSettings',
        defaultQuarterlyReminder: enabled,
      });
      this.showAlert(`Default quarterly reminder ${enabled ? 'enabled' : 'disabled'} for new contacts`, 'success');
    });

    document.getElementById('contactForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveContact();
    });

    document.getElementById('clearForm').addEventListener('click', () => {
      this.clearForm();
    });

    ['fullName', 'jobTitle', 'company', 'location'].forEach((fieldId) => {
      const element = document.getElementById(fieldId);
      element?.addEventListener('input', () => {
        if (element.value.trim()) {
          element.classList.remove('not-found');
          const hintEl = document.getElementById(`${fieldId}Hint`);
          if (hintEl) {
            hintEl.textContent = '';
            hintEl.className = 'field-hint';
          }
        }
      });
    });

    ['fullName', 'email', 'followUpDate'].forEach((fieldId) => {
      document.getElementById(fieldId).addEventListener('blur', () => this.validateField(fieldId));
    });
    document.getElementById('followUpDate').addEventListener('change', () => {
      this.validateField('followUpDate');
      this.updateCadencePreview();
    });
    document.getElementById('followUpDate').addEventListener('input', () => {
      this.updateCadencePreview();
    });
    document.getElementById('contactDate').addEventListener('change', () => {
      this.updateCadencePreview();
    });
    document.getElementById('contactDate').addEventListener('input', () => {
      this.updateCadencePreview();
    });
    document.getElementById('quarterlyReminder')?.addEventListener('change', () => {
      this.updateCadencePreview();
    });

    // Quick Date Pills (+2 Weeks, +1 Month, +1 Quarter, Clear)
    document.querySelectorAll('.date-pill[data-days]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const days = parseInt(btn.getAttribute('data-days'), 10);
        if (isNaN(days)) return;
        const now = new Date();
        const target = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const targetStr = target.toISOString().split('T')[0];
        const followUpInput = document.getElementById('followUpDate');
        if (followUpInput) {
          followUpInput.value = targetStr;
          this.validateField('followUpDate');
          this.updateCadencePreview();
        }
      });
    });

    document.getElementById('clearFollowUpBtn')?.addEventListener('click', () => {
      const followUpInput = document.getElementById('followUpDate');
      if (followUpInput) {
        followUpInput.value = '';
        this.clearFieldError('followUpDate');
        this.updateCadencePreview();
      }
    });

    document.getElementById('addTagBtn')?.addEventListener('click', () => {
      this.showTagsDropdown();
    });

    document.getElementById('tagSearch')?.addEventListener('input', () => {
      this.renderTagsDropdownItems();
    });

    document.getElementById('tagSearch')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = e.target.value.trim();
        if (value) {
          this.addTag(value);
          e.target.value = '';
        }
      }
    });

    document.addEventListener('click', (e) => {
      const container = document.getElementById('tagsContainer');
      const dropdown = document.getElementById('tagsDropdown');
      if (container && dropdown && !container.contains(e.target) && !dropdown.contains(e.target)) {
        this.hideTagsDropdown();
      }
    });

    document.getElementById('refreshTagsBtn')?.addEventListener('click', () => {
      this.loadTagOptions(true);
    });

    document.getElementById('reloadPageBtn')?.addEventListener('click', () => {
      this.reloadCurrentTab();
    });

    document.getElementById('refreshLinkedinBtn')?.addEventListener('click', () => {
      this.refreshFromLinkedin();
    });
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'profileExtractionProgress':
        this.updateStatus(request.message, request.type || 'loading');
        if (request.reloadSuggested) {
          this.showReloadPrompt(request.message || 'If profile details appear incomplete or stuck, please refresh the LinkedIn page and launch the extension again.');
        } else if (request.type === 'ready' || request.type === 'success') {
          this.hideReloadPrompt();
        }
        sendResponse({ success: true });
        break;

      case 'profileDataExtracted':
        if (this.isExistingContactLoaded && !this.isManualRefreshing) {
          console.log('Ignored auto-extracted profile message because saved contact is currently loaded.');
          sendResponse({ success: true });
          break;
        }
        this.populateForm(request.data);
        if (this.isManualRefreshing) {
          this.isManualRefreshing = false;
          this.showAlert('Refreshed live data from LinkedIn. Click Update Contact to save changes.', 'info');
          this.updateStatus('Refreshed from LinkedIn', 'success');
        } else {
          this.updateStatus('Profile data loaded');
        }
        sendResponse({ success: true });
        break;

      case 'profileExtractionError':
        this.showAlert(`Failed to extract profile data: ${request.error}`, 'error');
        this.updateStatus('Extraction failed', 'error');
        this.showReloadPrompt('Profile couldn\'t be read cleanly. Please refresh the LinkedIn page and launch the extension again.');
        sendResponse({ success: true });
        break;

      // Sync brought in remote changes — refresh what we are showing.
      case 'contactsUpdated':
        this.refreshSyncStatus();
        this.loadTagOptions();
        if (this.currentProfileData?.profileUrl) {
          this.loadExistingContact(this.currentProfileData.profileUrl);
        }
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  }

  /* --------------------------- sync settings -------------------------- */

  toggleConfiguration() {
    const toggle = document.getElementById('configToggle');
    const content = document.getElementById('configContent');
    const isExpanded = content.classList.contains('expanded');

    content.classList.toggle('expanded', !isExpanded);
    toggle.classList.toggle('expanded', !isExpanded);
  }

  async loadSyncSettings() {
    const state = await chrome.runtime.sendMessage({ action: 'getSyncState' });
    const urlInput = document.getElementById('supabaseUrl');
    if (urlInput && state?.supabaseUrl) urlInput.value = state.supabaseUrl;

    const keyInput = document.getElementById('supabaseAnonKey');
    if (keyInput && state?.hasAnonKey) {
      keyInput.placeholder = 'Anon key saved — enter a new one to replace';
    }

    const defaultQuarterlyEl = document.getElementById('defaultQuarterlyReminder');
    if (defaultQuarterlyEl) {
      const enabled = state?.defaultQuarterlyReminder !== undefined ? Boolean(state.defaultQuarterlyReminder) : true;
      defaultQuarterlyEl.checked = enabled;
      this.defaultQuarterlyReminder = enabled;
    }
  }

  async saveConnection() {
    const urlInput = document.getElementById('supabaseUrl');
    const keyInput = document.getElementById('supabaseAnonKey');
    const url = urlInput.value.trim();
    const anonKey = keyInput.value.trim();

    if (!/^https:\/\/.+/.test(url)) {
      this.showAlert('Enter your Supabase Project URL (https://...)', 'error');
      return;
    }
    if (!anonKey) {
      this.showAlert('Enter the publishable (anon) key', 'error');
      return;
    }

    this.updateStatus('Connecting...', 'loading');
    const result = await chrome.runtime.sendMessage({ action: 'setConnection', url, anonKey });

    if (result?.success) {
      keyInput.value = '';
      keyInput.placeholder = 'Anon key saved — enter a new one to replace';
      this.showAlert('Connected to Supabase.', 'success');
      await this.loadTagOptions();
    } else {
      this.showAlert(`Connection failed: ${result?.error || 'unknown error'}`, 'error');
    }
    await this.refreshSyncStatus();
  }

  async syncNow() {
    this.updateStatus('Syncing...', 'loading');
    const result = await chrome.runtime.sendMessage({ action: 'syncNow', full: true });
    if (result?.success) {
      this.showAlert('Sync complete', 'success');
      await this.loadTagOptions();
      if (this.currentProfileData?.profileUrl) {
        await this.loadExistingContact(this.currentProfileData.profileUrl);
      }
    } else {
      this.showAlert(`Sync failed: ${result?.error || result?.lastError || 'unknown error'}`, 'error');
    }
    await this.refreshSyncStatus();
  }

  async refreshSyncStatus() {
    const state = await chrome.runtime.sendMessage({ action: 'getSyncState' });
    if (!state) return;

    const pendingEl = document.getElementById('pendingCount');
    const lastSyncedEl = document.getElementById('lastSynced');
    const errorEl = document.getElementById('syncError');

    if (pendingEl) pendingEl.textContent = String(state.pendingCount || 0);
    if (lastSyncedEl) {
      lastSyncedEl.textContent = state.lastPulledAt
        ? new Date(state.lastPulledAt).toLocaleString()
        : 'Never';
    }
    if (errorEl) {
      errorEl.textContent = state.lastError || '';
      errorEl.classList.toggle('visible', Boolean(state.lastError));
    }

    if (!state.hasAnonKey) {
      this.updateStatus('Local mode');
    } else if (!state.online) {
      this.updateStatus(`Offline (${state.pendingCount || 0})`, 'error');
    } else if (state.pendingCount) {
      this.updateStatus(`Syncing (${state.pendingCount})...`, 'loading');
    } else if (state.connected) {
      this.updateStatus('Synced');
    } else if (state.lastError) {
      this.updateStatus('Sync issue', 'error');
    } else {
      this.updateStatus('Ready');
    }
  }

  /* ------------------------------- page ------------------------------- */

  async checkCurrentPage() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      if (!currentTab || !currentTab.url?.includes('linkedin.com/in/')) {
        this.updateStatus('Navigate to profile');
        this.hideReloadPrompt();
        this.hideRefreshLinkedinBtn();
        return;
      }

      this.updateStatus('Checking saved contact...', 'loading');
      this.hideReloadPrompt();

      const profileUrl = currentTab.url.split('?')[0].split('#')[0];

      // Check if profile is already saved in database first
      const result = await chrome.runtime.sendMessage({ action: 'getContactByUrl', profileUrl });

      if (result?.exists && result.contact) {
        console.log('✅ Profile is already saved. Surfacing saved data.');
        this.isExistingContactLoaded = true;
        this.existingContactId = result.contact.id;
        this.showSavedIndicator(true);
        this.updateSaveButton(true);
        this.showRefreshLinkedinBtn();

        // Display all saved data in form
        this.populateAllFromSavedRecord(result.contact);
        this.updateStatus('Saved profile loaded', 'success');
        this.showAlert('Loaded saved contact details', 'success');
        return; // Skip automatic live page DOM extraction
      }

      // New profile: prepare for auto-extraction
      this.isExistingContactLoaded = false;
      this.existingContactId = null;
      this.showSavedIndicator(false);
      this.updateSaveButton(false);
      this.hideRefreshLinkedinBtn();

      let attempts = 0;
      const maxAttempts = 3;

      const triggerExtraction = async () => {
        attempts++;
        try {
          this.updateStatus(`Extracting profile (${attempts}/${maxAttempts})...`, 'loading');
          const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'extractProfile' });
          if (res?.started || res?.profileData) {
            return;
          }
        } catch (err) {
          // If receiving end does not exist, inject content script dynamically and retry
          if (chrome.scripting && (err?.message?.includes('Receiving end does not exist') || err?.message?.includes('Could not establish connection'))) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                files: ['content.js']
              });
            } catch (injectErr) {
              console.debug('Dynamic script injection notice:', injectErr);
            }
          }

          if (attempts < maxAttempts) {
            setTimeout(triggerExtraction, 1000);
          } else {
            console.warn('Tab did not respond to extractProfile message:', err);
            this.updateStatus('Page not responding', 'error');
            this.showReloadPrompt('LinkedIn page is not responding. Please refresh the page and launch the extension again.');
          }
        }
      };

      setTimeout(triggerExtraction, 800);
    } catch (error) {
      console.error('Failed to check current page:', error);
      this.updateStatus('Ready to extract');
    }
  }

  populateAllFromSavedRecord(contact) {
    this.currentProfileData = {
      fullName: contact.fullName || '',
      jobTitle: contact.jobTitle || '',
      company: contact.company || '',
      location: contact.location || '',
      profileUrl: contact.profileUrl || '',
      profilePicture: contact.profilePicture || '',
    };

    const textFields = [
      'fullName',
      'jobTitle',
      'company',
      'location',
      'profileUrl',
      'email',
      'phone',
      'notes',
    ];

    textFields.forEach((fieldId) => {
      const el = document.getElementById(fieldId);
      if (el) {
        el.value = contact[fieldId] || '';
        el.classList.remove('not-found', 'auto-filled');
        el.placeholder = '';
        const hint = document.getElementById(`${fieldId}Hint`);
        if (hint) {
          hint.textContent = '';
          hint.className = 'field-hint';
        }
      }
    });

    ['contactDate', 'followUpDate'].forEach((fieldId) => {
      const el = document.getElementById(fieldId);
      if (el) {
        if (contact[fieldId]) {
          const date = new Date(contact[fieldId]);
          el.value = !Number.isNaN(date.getTime()) ? date.toISOString().split('T')[0] : '';
        } else {
          el.value = '';
        }
      }
    });

    const quarterlyEl = document.getElementById('quarterlyReminder');
    if (quarterlyEl) {
      quarterlyEl.checked = contact.quarterlyReminder !== undefined ? Boolean(contact.quarterlyReminder) : true;
    }

    if (contact.tags) {
      this.selectedTags = Array.isArray(contact.tags)
        ? [...contact.tags]
        : String(contact.tags)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    } else {
      this.selectedTags = [];
    }
    this.renderTagChips();

    this.displayProfilePicture(contact.profilePicture);
    this.hideReloadPrompt();
    this.updateCadencePreview();
    this.updateReconnectDueBanner(contact);
  }

  async refreshFromLinkedin() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      if (!currentTab || !currentTab.url?.includes('linkedin.com/in/')) {
        this.showAlert('Please navigate to a LinkedIn profile page first', 'warning');
        return;
      }

      this.isManualRefreshing = true;
      this.updateStatus('Refreshing live data...', 'loading');

      const refreshBtn = document.getElementById('refreshLinkedinBtn');
      if (refreshBtn) {
        refreshBtn.classList.add('refreshing');
        refreshBtn.disabled = true;
      }

      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'extractProfile' });
      if (res?.profileData) {
        this.populateForm(res.profileData);
        this.showAlert('Refreshed live data from LinkedIn. Click Update Contact to save changes.', 'info');
        this.updateStatus('Refreshed from LinkedIn', 'success');
      }
    } catch (err) {
      console.error('Failed to refresh from LinkedIn:', err);
      this.showAlert('Could not extract live profile data. Please refresh the LinkedIn page and try again.', 'error');
      this.updateStatus('Refresh failed', 'error');
    } finally {
      this.isManualRefreshing = false;
      const refreshBtn = document.getElementById('refreshLinkedinBtn');
      if (refreshBtn) {
        refreshBtn.classList.remove('refreshing');
        refreshBtn.disabled = false;
      }
    }
  }

  showRefreshLinkedinBtn() {
    const btn = document.getElementById('refreshLinkedinBtn');
    if (btn) btn.style.display = 'inline-flex';
  }

  hideRefreshLinkedinBtn() {
    const btn = document.getElementById('refreshLinkedinBtn');
    if (btn) btn.style.display = 'none';
  }

  populateForm(profileData) {
    this.currentProfileData = profileData;

    ['fullName', 'jobTitle', 'company', 'location'].forEach((fieldId) => {
      const element = document.getElementById(fieldId);
      const hintEl = document.getElementById(`${fieldId}Hint`);
      const val = profileData[fieldId] ? String(profileData[fieldId]).trim() : '';

      if (element) {
        if (val) {
          element.value = val;
          element.placeholder = '';
          element.classList.add('auto-filled');
          element.classList.remove('not-found');
          this.clearFieldError(fieldId);
          if (hintEl) {
            hintEl.textContent = '';
            hintEl.className = 'field-hint';
          }
        } else {
          element.value = '';
          element.placeholder = 'Could not be extracted — enter manually';
          element.classList.remove('auto-filled');
          element.classList.add('not-found');
          if (hintEl) {
            hintEl.textContent = 'Could not be extracted — please enter manually';
            hintEl.className = 'field-hint field-hint--warning';
          }
        }
      }
    });

    const profileUrlField = document.getElementById('profileUrl');
    if (profileUrlField) profileUrlField.value = profileData.profileUrl || '';

    this.displayProfilePicture(profileData.profilePicture);

    if (profileData.profileUrl) {
      this.loadExistingContact(profileData.profileUrl);
    } else {
      const quarterlyEl = document.getElementById('quarterlyReminder');
      if (quarterlyEl) {
        quarterlyEl.checked = this.defaultQuarterlyReminder;
      }
      this.updateCadencePreview();
      this.updateReconnectDueBanner(null);
    }

    this.renderExtractionWarnings(profileData._validation);

    const v = profileData._validation;
    if (!profileData.fullName || (!profileData.jobTitle && !profileData.company) || (v && v.warnings && v.warnings.length)) {
      this.showReloadPrompt('Some profile fields may be missing or unreadable. Please refresh the LinkedIn page and launch the extension again.');
    } else {
      this.hideReloadPrompt();
    }

    if (v && v.warnings && v.warnings.length) {
      const errCount = v.warnings.filter((w) => w.severity === 'error').length;
      const msg =
        errCount > 0
          ? `Profile extracted with ${errCount} problem${errCount === 1 ? '' : 's'} — please review`
          : `Profile extracted with ${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'}`;
      this.showAlert(msg, errCount > 0 ? 'error' : 'warning');
    } else {
      this.showAlert('Profile data extracted successfully', 'success');
    }
  }

  renderExtractionWarnings(validation) {
    const existing = document.getElementById('extractionWarnings');
    if (existing) existing.remove();

    document
      .querySelectorAll('.field-input.extraction-warning, .field-input.extraction-error')
      .forEach((el) => el.classList.remove('extraction-warning', 'extraction-error'));

    if (!validation || !validation.warnings || !validation.warnings.length) return;

    const { warnings, confidence } = validation;
    const errors = warnings.filter((w) => w.severity === 'error');
    const isError = errors.length > 0;

    const banner = document.createElement('div');
    banner.id = 'extractionWarnings';
    banner.className = `extraction-warnings ${isError ? 'extraction-warnings--error' : 'extraction-warnings--warn'}`;

    const header = document.createElement('div');
    header.className = 'extraction-warnings__header';
    const pct = Math.round((confidence ?? 0) * 100);
    header.textContent = isError
      ? `⚠️ Low-confidence extraction (${pct}%) — verify before saving`
      : `Extraction warnings (${pct}% confidence)`;
    banner.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'extraction-warnings__list';
    warnings.forEach((w) => {
      const li = document.createElement('li');
      li.className = `extraction-warnings__item extraction-warnings__item--${w.severity}`;
      const label = document.createElement('strong');
      label.textContent = `${this.humanizeField(w.field)}: `;
      li.appendChild(label);
      li.appendChild(document.createTextNode(w.message));
      list.appendChild(li);

      const input = document.getElementById(w.field);
      if (input) {
        input.classList.add(w.severity === 'error' ? 'extraction-error' : 'extraction-warning');
      }
    });
    banner.appendChild(list);

    const form = document.querySelector('.contact-form') || document.body;
    form.insertBefore(banner, form.firstChild);
  }

  humanizeField(field) {
    const map = {
      fullName: 'Name',
      jobTitle: 'Job Title',
      company: 'Company',
      location: 'Location',
      profileUrl: 'Profile URL',
      profilePicture: 'Profile Picture',
    };
    return map[field] || field;
  }

  displayProfilePicture(pictureUrl) {
    const img = document.getElementById('profilePictureImg');
    const placeholder = document.getElementById('profilePicturePlaceholder');
    const loading = document.getElementById('profilePictureLoading');
    const status = document.getElementById('profilePictureStatus');

    if (!pictureUrl) {
      if (img) img.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
      if (loading) loading.style.display = 'none';
      if (status) {
        status.textContent = 'No profile picture found';
        status.className = 'profile-picture-status warning';
      }
      return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    if (status) status.className = 'profile-picture-status';

    if (img) {
      img.onload = () => {
        img.style.display = 'block';
        if (loading) loading.style.display = 'none';
        if (status) {
          status.textContent = 'Profile picture captured';
          status.className = 'profile-picture-status success';
        }
      };

      img.onerror = () => {
        img.style.display = 'none';
        if (loading) loading.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
        if (status) {
          status.textContent = 'Failed to load profile picture';
          status.className = 'profile-picture-status error';
        }
      };

      img.src = pictureUrl;
    }
  }

  /* ------------------------------- saving ------------------------------ */

  async saveContact() {
    if (this.isLoading) return;

    try {
      if (!this.validateForm()) {
        this.showAlert('Please fix the form errors before saving', 'error');
        return;
      }

      const contactData = this.collectFormData();
      if (this.existingContactId) contactData.id = this.existingContactId;

      this.setLoadingState(true);

      // Writes land in chrome.storage.local immediately; sync happens after.
      const result = await chrome.runtime.sendMessage({
        action: 'saveContact',
        data: contactData,
      });

      if (result?.success) {
        this.existingContactId = result.contact.id;
        this.showSavedIndicator(true);
        this.updateSaveButton(true);
        this.notifyContentScriptContactSaved();

        const state = await chrome.runtime.sendMessage({ action: 'getSyncState' });
        if (!state?.hasAnonKey) {
          this.showAlert('Saved locally. Add Supabase connection in settings to sync.', 'warning');
        } else if (!state.online) {
          this.showAlert('Saved locally. Will sync when you are back online.', 'warning');
        } else {
          this.showAlert('Contact saved', 'success');
        }

        await this.loadTagOptions();
        await this.refreshSyncStatus();
      } else {
        this.showAlert(result?.error || 'Failed to save contact', 'error');
        this.updateStatus('Save failed', 'error');
      }
    } catch (error) {
      console.error('Save contact error:', error);
      this.showAlert('An unexpected error occurred while saving', 'error');
      this.updateStatus('Save failed', 'error');
    } finally {
      this.setLoadingState(false);
    }
  }

  collectFormData() {
    return {
      fullName: document.getElementById('fullName').value.trim(),
      jobTitle: document.getElementById('jobTitle').value.trim(),
      company: document.getElementById('company').value.trim(),
      location: document.getElementById('location').value.trim(),
      profileUrl: document.getElementById('profileUrl').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      tags: [...this.selectedTags],
      notes: document.getElementById('notes').value.trim(),
      profilePicture: this.currentProfileData.profilePicture || '',
      contactDate: document.getElementById('contactDate').value.trim(),
      followUpDate: document.getElementById('followUpDate').value.trim(),
      quarterlyReminder: document.getElementById('quarterlyReminder') ? document.getElementById('quarterlyReminder').checked : true,
    };
  }

  /* ------------------------------ existing ----------------------------- */

  async loadExistingContact(profileUrl) {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'getContactByUrl', profileUrl });

      if (result?.exists && result.contact) {
        this.existingContactId = result.contact.id;
        this.showSavedIndicator(true);
        this.updateSaveButton(true);
        this.populateWithExistingData(result.contact);
      } else {
        this.existingContactId = null;
        this.showSavedIndicator(false);
        this.updateSaveButton(false);
        const quarterlyEl = document.getElementById('quarterlyReminder');
        if (quarterlyEl) {
          quarterlyEl.checked = this.defaultQuarterlyReminder;
        }
        this.updateCadencePreview();
        this.updateReconnectDueBanner(null);
      }
    } catch (error) {
      console.log('Could not look up existing contact:', error);
    }
  }

  /**
   * Keep freshly scraped profile info, but restore the fields the user owns.
   */
  populateWithExistingData(contact) {
    ['notes', 'tags', 'followUpDate', 'contactDate'].forEach((field) => {
      if (contact[field] !== undefined && contact[field] !== null && contact[field] !== '') {
        this.setFormFieldValue(field, contact[field]);
      }
    });

    const quarterlyEl = document.getElementById('quarterlyReminder');
    if (quarterlyEl) {
      quarterlyEl.checked = contact.quarterlyReminder !== undefined ? Boolean(contact.quarterlyReminder) : true;
    }

    ['email', 'phone'].forEach((field) => {
      const element = document.getElementById(field);
      if (element && !element.value.trim() && contact[field]) {
        this.setFormFieldValue(field, contact[field]);
      }
    });

    this.updateCadencePreview();
    this.updateReconnectDueBanner(contact);
  }

  setFormFieldValue(formField, value) {
    if (formField === 'tags') {
      this.selectedTags = Array.isArray(value)
        ? [...value]
        : String(value)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
      this.renderTagChips();
      return;
    }

    const element = document.getElementById(formField);
    if (!element) return;

    if (formField === 'followUpDate' || formField === 'contactDate') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        element.value = date.toISOString().split('T')[0];
      }
    } else {
      element.value = value;
    }
  }

  /* ----------------------------- validation ---------------------------- */

  validateForm() {
    let isValid = this.validateField('fullName');

    const email = document.getElementById('email').value.trim();
    if (email && !this.isValidEmail(email)) {
      this.showFieldError('email', 'Please enter a valid email address');
      isValid = false;
    } else {
      this.clearFieldError('email');
    }

    if (document.getElementById('followUpDate').value.trim()) {
      isValid = this.validateField('followUpDate') && isValid;
    }

    return isValid;
  }

  validateField(fieldId) {
    const field = document.getElementById(fieldId);
    const value = field.value.trim();

    if (fieldId === 'fullName' && !value) {
      this.showFieldError(fieldId, 'Full name is required');
      return false;
    }

    if (fieldId === 'email' && value && !this.isValidEmail(value)) {
      this.showFieldError(fieldId, 'Please enter a valid email address');
      return false;
    }

    if (fieldId === 'followUpDate' && value) {
      const selectedDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (selectedDate <= today) {
        this.showFieldError(fieldId, 'Follow up date must be in the future');
        return false;
      }
    }

    this.clearFieldError(fieldId);
    return true;
  }

  showFieldError(fieldId, message) {
    const errorElement = document.getElementById(`${fieldId}Error`);
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.add('visible');
    }
    const field = document.getElementById(fieldId);
    if (field) field.style.borderColor = 'var(--error-color)';
  }

  clearFieldError(fieldId) {
    const errorElement = document.getElementById(`${fieldId}Error`);
    if (errorElement) errorElement.classList.remove('visible');
    const field = document.getElementById(fieldId);
    if (field) field.style.borderColor = '';
  }

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /* -------------------------------- tags ------------------------------- */

  async loadTagOptions(announce = false) {
    const tagsHint = document.getElementById('tagsHint');
    const totalTagsElement = document.getElementById('totalTags');

    try {
      const result = await chrome.runtime.sendMessage({ action: 'getTagOptions' });
      this.tagOptions = result?.options || [];

      if (totalTagsElement) totalTagsElement.textContent = String(this.tagOptions.length);
      if (tagsHint) {
        tagsHint.textContent = this.tagOptions.length
          ? 'Pick an existing tag or type a new one and press Enter.'
          : 'Type a tag and press Enter to create your first one.';
      }
      if (announce) {
        this.showAlert(`${this.tagOptions.length} tag(s) available`, 'success');
      }
      this.renderTagChips();
    } catch (error) {
      console.error('Error loading tag options:', error);
      this.tagOptions = [];
    }
  }

  renderTagChips() {
    const chipsContainer = document.getElementById('tagsChips');
    const hiddenInput = document.getElementById('tags');
    if (!chipsContainer) return;

    chipsContainer.innerHTML = '';

    this.selectedTags.forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.style.backgroundColor = this.getTagColor(tag);
      chip.style.color = '#1f2937';
      chip.appendChild(document.createTextNode(tag));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-chip__remove';
      removeBtn.title = 'Remove tag';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeTag(tag);
      });

      chip.appendChild(removeBtn);
      chipsContainer.appendChild(chip);
    });

    if (hiddenInput) hiddenInput.value = this.selectedTags.join(', ');
  }

  showTagsDropdown() {
    const dropdown = document.getElementById('tagsDropdown');
    if (!dropdown) return;
    dropdown.classList.add('visible');
    this.renderTagsDropdownItems();
    document.getElementById('tagSearch')?.focus();
  }

  renderTagsDropdownItems() {
    const emptyEl = document.getElementById('tagsDropdownEmpty');
    const contentEl = document.getElementById('tagsDropdownContent');
    const query = (document.getElementById('tagSearch')?.value || '').trim().toLowerCase();

    const available = this.tagOptions.filter(
      (tag) =>
        !this.selectedTags.some((t) => t.toLowerCase() === tag.name.toLowerCase()) &&
        (!query || tag.name.toLowerCase().includes(query)),
    );

    if (contentEl) contentEl.innerHTML = '';

    if (!available.length) {
      if (emptyEl) {
        emptyEl.textContent = query
          ? `Press Enter to create "${query}"`
          : 'No saved tags yet — type to create one';
        emptyEl.style.display = 'block';
      }
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    available.slice(0, 20).forEach((tag) => {
      const item = document.createElement('div');
      item.className = 'tags-dropdown-item';

      const colorDot = document.createElement('span');
      colorDot.className = 'tag-color-dot';
      colorDot.style.backgroundColor = this.getTagColor(tag.name);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'tags-dropdown-item__name';
      nameSpan.textContent = tag.name;

      item.appendChild(colorDot);
      item.appendChild(nameSpan);
      item.addEventListener('click', () => this.addTag(tag.name));

      if (contentEl) contentEl.appendChild(item);
    });

    if (available.length > 20 && contentEl) {
      const moreEl = document.createElement('div');
      moreEl.className = 'tags-dropdown__more';
      moreEl.textContent = `+${available.length - 20} more — keep typing to filter`;
      contentEl.appendChild(moreEl);
    }
  }

  hideTagsDropdown() {
    document.getElementById('tagsDropdown')?.classList.remove('visible');
    const search = document.getElementById('tagSearch');
    if (search) search.value = '';
  }

  addTag(tagName) {
    if (typeof tagName !== 'string' || !tagName.trim()) return;

    const existing = this.tagOptions.find(
      (opt) => opt.name.toLowerCase() === tagName.trim().toLowerCase(),
    );
    const normalized = existing?.name || tagName.trim();

    if (!this.selectedTags.some((t) => t.toLowerCase() === normalized.toLowerCase())) {
      this.selectedTags.push(normalized);
      this.renderTagChips();
    }
    this.hideTagsDropdown();
  }

  removeTag(tagName) {
    this.selectedTags = this.selectedTags.filter((t) => t !== tagName);
    this.renderTagChips();
  }

  /** Stable pastel colour derived from the tag name — no remote palette needed. */
  getTagColor(tagName) {
    const palette = [
      '#cfdfff',
      '#d0f0fd',
      '#d1f7c4',
      '#ffeab6',
      '#fee2d5',
      '#ffdce5',
      '#ffdaf6',
      '#ede2fe',
      '#c2f5e9',
      '#eeeeee',
    ];
    let hash = 0;
    for (let i = 0; i < tagName.length; i += 1) {
      hash = (hash * 31 + tagName.charCodeAt(i)) % 100000;
    }
    return palette[hash % palette.length];
  }

  /* ------------------------------ chrome UI ---------------------------- */

  showSavedIndicator(show) {
    const indicator = document.getElementById('savedIndicator');
    if (indicator) indicator.style.display = show ? 'inline-block' : 'none';
  }

  updateSaveButton(isUpdate) {
    const btnText = document.getElementById('saveContact')?.querySelector('.btn__text');
    if (btnText) btnText.textContent = isUpdate ? 'Update Contact' : 'Save Contact';
  }

  notifyContentScriptContactSaved() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'contactSaved' }, () => {
          if (chrome.runtime.lastError) {
            console.log('Could not notify content script:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  }

  clearManualFields() {
    ['email', 'phone', 'notes', 'contactDate', 'followUpDate'].forEach((fieldId) => {
      const field = document.getElementById(fieldId);
      if (field) field.value = '';
    });

    this.selectedTags = [];
    this.renderTagChips();
  }

  clearForm() {
    const form = document.getElementById('contactForm');
    if (form) {
      form.reset();
      form.querySelectorAll('.auto-filled').forEach((f) => f.classList.remove('auto-filled'));
      form.querySelectorAll('.not-found').forEach((f) => {
        f.classList.remove('not-found');
        f.placeholder = '';
      });
      form.querySelectorAll('.field-hint').forEach((h) => {
        h.textContent = '';
        h.className = 'field-hint';
      });
      form.querySelectorAll('.field-error').forEach((e) => e.classList.remove('visible'));
      form
        .querySelectorAll('.field-input, .field-textarea')
        .forEach((f) => (f.style.borderColor = ''));
    }

    const img = document.getElementById('profilePictureImg');
    const placeholder = document.getElementById('profilePicturePlaceholder');
    const loading = document.getElementById('profilePictureLoading');
    const status = document.getElementById('profilePictureStatus');

    if (img) img.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    if (loading) loading.style.display = 'none';
    if (status) {
      status.textContent = '';
      status.className = 'profile-picture-status';
    }

    this.currentProfileData = {};
    this.existingContactId = null;
    this.selectedTags = [];
    this.renderTagChips();
    this.showSavedIndicator(false);
    this.updateSaveButton(false);

    const quarterlyEl = document.getElementById('quarterlyReminder');
    if (quarterlyEl) {
      quarterlyEl.checked = this.defaultQuarterlyReminder;
    }
    this.updateCadencePreview();
    this.updateReconnectDueBanner(null);

    this.showAlert('Form cleared', 'success');
  }

  updateCadencePreview() {
    const followUpEl = document.getElementById('followUpDate');
    const contactDateEl = document.getElementById('contactDate');
    const quarterlyEl = document.getElementById('quarterlyReminder');
    const statusBanner = document.getElementById('cadenceStatusBanner');
    const statusIcon = document.getElementById('cadenceStatusIcon');
    const statusText = document.getElementById('cadenceStatusText');

    if (!statusBanner || !statusText || !statusIcon) return;

    const followUpVal = followUpEl?.value?.trim();
    const contactDateVal = contactDateEl?.value?.trim();
    const isQuarterly = quarterlyEl ? quarterlyEl.checked : true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (followUpVal) {
      const fDate = new Date(followUpVal + 'T00:00:00');
      if (!isNaN(fDate.getTime())) {
        const diffDays = Math.round((fDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const formatted = fDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

        statusBanner.className = 'cadence-status-banner cadence-status-banner--custom';
        statusIcon.textContent = '📌';
        if (diffDays < 0) {
          statusText.innerHTML = `Specific follow-up was due on <strong>${formatted}</strong> (${Math.abs(diffDays)}d overdue)`;
        } else if (diffDays === 0) {
          statusText.innerHTML = `Specific follow-up is <strong>due today</strong> (${formatted})`;
        } else {
          statusText.innerHTML = `Specific follow-up set for <strong>${formatted}</strong> (in ${diffDays}d). Quarterly reminder will follow after.`;
        }
        return;
      }
    }

    if (!isQuarterly) {
      statusBanner.className = 'cadence-status-banner cadence-status-banner--off';
      statusIcon.textContent = '⏸️';
      statusText.textContent = 'Quarterly reminder disabled for this contact.';
      return;
    }

    // Quarterly is ON and no specific follow-up date is set
    let baseDate = today;
    let isFromCatchup = false;
    if (contactDateVal) {
      const cDate = new Date(contactDateVal + 'T00:00:00');
      if (!isNaN(cDate.getTime())) {
        baseDate = cDate;
        isFromCatchup = true;
      }
    }

    const nextQuarter = new Date(baseDate.getTime() + 90 * 24 * 60 * 60 * 1000);
    const diffDays = Math.round((nextQuarter.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const formatted = nextQuarter.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    if (diffDays < 0) {
      statusBanner.className = 'cadence-status-banner cadence-status-banner--overdue';
      statusIcon.textContent = '⚠️';
      statusText.innerHTML = `Quarterly reconnect was due on <strong>${formatted}</strong> (${Math.abs(diffDays)}d overdue${isFromCatchup ? ' since last catchup' : ''})!`;
    } else if (diffDays === 0) {
      statusBanner.className = 'cadence-status-banner cadence-status-banner--due';
      statusIcon.textContent = '🔔';
      statusText.innerHTML = `Quarterly reconnect is <strong>due today</strong> (${formatted})!`;
    } else if (diffDays <= 7) {
      statusBanner.className = 'cadence-status-banner cadence-status-banner--soon';
      statusIcon.textContent = '🔔';
      statusText.innerHTML = `Quarterly reconnect due soon: <strong>${formatted}</strong> (in ${diffDays} day${diffDays === 1 ? '' : 's'})`;
    } else {
      statusBanner.className = 'cadence-status-banner cadence-status-banner--scheduled';
      statusIcon.textContent = '🗓️';
      statusText.innerHTML = `Next quarterly reconnect: <strong>${formatted}</strong> (in ~${diffDays} days${isFromCatchup ? ' from last catchup' : ''})`;
    }
  }

  updateReconnectDueBanner(contact) {
    const banner = document.getElementById('reconnectDueBanner');
    const titleEl = document.getElementById('reconnectDueTitle');
    const descEl = document.getElementById('reconnectDueDesc');
    if (!banner || !titleEl || !descEl) return;

    if (!contact) {
      banner.style.display = 'none';
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (contact.followUpDate) {
      const fDate = new Date(contact.followUpDate + 'T00:00:00');
      if (!isNaN(fDate.getTime())) {
        const diffDays = Math.round((fDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const formatted = fDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        if (diffDays <= 0) {
          banner.style.display = 'flex';
          banner.className = 'reconnect-banner reconnect-banner--overdue';
          titleEl.textContent = diffDays === 0 ? 'Follow-up Due Today' : 'Follow-up Overdue';
          descEl.textContent = diffDays === 0
            ? `Scheduled for today (${formatted}). Time to reach out!`
            : `Was scheduled for ${formatted} (${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} ago).`;
          return;
        } else if (diffDays <= 3) {
          banner.style.display = 'flex';
          banner.className = 'reconnect-banner reconnect-banner--soon';
          titleEl.textContent = 'Follow-up Due Soon';
          descEl.textContent = `Scheduled in ${diffDays} day${diffDays === 1 ? '' : 's'} on ${formatted}.`;
          return;
        }
      }
    }

    if (contact.quarterlyReminder !== false && !contact.followUpDate) {
      const baseDateStr = contact.contactDate || contact.createdAt || contact.modifiedAt;
      if (baseDateStr) {
        const base = new Date(baseDateStr);
        if (!isNaN(base.getTime())) {
          const nextQuarter = new Date(base.getTime() + 90 * 24 * 60 * 60 * 1000);
          const diffDays = Math.round((nextQuarter.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const formatted = nextQuarter.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          if (diffDays <= 0) {
            banner.style.display = 'flex';
            banner.className = 'reconnect-banner reconnect-banner--overdue';
            titleEl.textContent = diffDays === 0 ? 'Quarterly Reconnect Due Today' : 'Quarterly Reconnect Overdue';
            descEl.textContent = diffDays === 0
              ? `90 days since last contact (${formatted}). Time for a check-in!`
              : `Last contact was over 90 days ago (${Math.abs(diffDays)} days past quarterly cadence).`;
            return;
          } else if (diffDays <= 7) {
            banner.style.display = 'flex';
            banner.className = 'reconnect-banner reconnect-banner--soon';
            titleEl.textContent = 'Quarterly Reconnect Due Soon';
            descEl.textContent = `Reach out in ${diffDays} day${diffDays === 1 ? '' : 's'} (${formatted}) to maintain cadence.`;
            return;
          }
        }
      }
    }

    banner.style.display = 'none';
  }

  setLoadingState(loading) {
    this.isLoading = loading;
    const saveButton = document.getElementById('saveContact');
    saveButton.classList.toggle('loading', loading);
    saveButton.disabled = loading;
  }

  updateStatus(text, type = 'ready') {
    const statusText = document.querySelector('.status-text');
    const statusDot = document.querySelector('.status-dot');

    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.className = 'status-dot';
      if (type === 'loading') statusDot.classList.add('loading');
      else if (type === 'error') statusDot.classList.add('error');
    }
  }

  async reloadCurrentTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        this.updateStatus('Refreshing page...', 'loading');
        this.showReloadPrompt('Reloading LinkedIn page... please wait a moment.');
        await chrome.tabs.reload(tabs[0].id);

        setTimeout(() => {
          this.checkCurrentPage();
        }, 3000);
      }
    } catch (err) {
      console.error('Error reloading tab:', err);
    }
  }

  showReloadPrompt(customMessage) {
    const banner = document.getElementById('reloadPromptBanner');
    const msgEl = document.getElementById('reloadPromptMessage');
    if (msgEl && customMessage) {
      msgEl.textContent = customMessage;
    }
    if (banner) {
      banner.style.display = 'flex';
    }
  }

  hideReloadPrompt() {
    const banner = document.getElementById('reloadPromptBanner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  showAlert(message, type = 'success') {
    const alertElement = document.getElementById('alertMessage');
    if (!alertElement) return;

    alertElement.textContent = message;
    alertElement.className = `alert alert--${type} visible`;
    setTimeout(() => alertElement.classList.remove('visible'), 4000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SidePanelManager();
});
