/**
 * Side panel UI. Every read comes from the local store via the service worker;
 * saving never blocks on the network.
 */

class SidePanelManager {
  constructor() {
    this.isLoading = false;
    this.currentProfileData = {};
    this.existingContactId = null;
    this.tagOptions = [];
    this.selectedTags = [];
    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.setupMessageListener();
    await this.loadSyncSettings();
    await this.loadTagOptions();
    await this.refreshSyncStatus();
    await this.checkCurrentPage();
  }

  /* ----------------------------- wiring ----------------------------- */

  setupEventListeners() {
    document.getElementById('configToggle').addEventListener('click', () => {
      this.toggleConfiguration();
    });

    document.getElementById('saveConfig').addEventListener('click', () => {
      this.saveDeviceKey();
    });

    document.getElementById('syncNow')?.addEventListener('click', () => {
      this.syncNow();
    });

    document.getElementById('contactForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveContact();
    });

    document.getElementById('clearForm').addEventListener('click', () => {
      this.clearForm();
    });

    ['fullName', 'email', 'followUpDate'].forEach((fieldId) => {
      document.getElementById(fieldId).addEventListener('blur', () => this.validateField(fieldId));
    });
    document.getElementById('followUpDate').addEventListener('change', () => {
      this.validateField('followUpDate');
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
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'profileDataExtracted':
        this.populateForm(request.data);
        this.updateStatus('Profile data loaded');
        sendResponse({ success: true });
        break;

      case 'profileExtractionError':
        this.showAlert(`Failed to extract profile data: ${request.error}`, 'error');
        this.updateStatus('Error', 'error');
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
    if (state?.hasDeviceKey) {
      const input = document.getElementById('deviceKey');
      if (input) input.placeholder = 'Device key saved — enter a new one to replace';
    }
  }

  async saveDeviceKey() {
    const input = document.getElementById('deviceKey');
    const key = input.value.trim();

    if (!key) {
      this.showAlert('Enter a device key to enable sync', 'error');
      return;
    }
    if (key.length < 12) {
      this.showAlert('Use at least 12 characters — this key protects your data', 'error');
      return;
    }

    this.updateStatus('Connecting...', 'loading');
    const result = await chrome.runtime.sendMessage({ action: 'setDeviceKey', deviceKey: key });

    if (result?.success) {
      input.value = '';
      input.placeholder = 'Device key saved — enter a new one to replace';
      this.showAlert('Device key saved. Sync is active.', 'success');
      await this.loadTagOptions();
    } else {
      this.showAlert(`Sync failed: ${result?.error || 'unknown error'}`, 'error');
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

    if (!state.hasDeviceKey) {
      this.updateStatus('Local only — add a device key to sync');
    } else if (!state.online) {
      this.updateStatus(`Offline — ${state.pendingCount || 0} change(s) queued`, 'error');
    } else if (state.pendingCount) {
      this.updateStatus(`Syncing ${state.pendingCount} change(s)...`, 'loading');
    } else if (state.connected) {
      this.updateStatus('Synced');
    } else if (state.lastError) {
      this.updateStatus('Sync issue — see settings', 'error');
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
        this.updateStatus('Navigate to a LinkedIn profile');
        return;
      }

      this.updateStatus('Waiting for profile data...', 'loading');

      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(currentTab.id, { action: 'extractProfile' });
        } catch {
          // Expected when the content script has not booted yet.
        }
      }, 2000);
    } catch (error) {
      console.error('Failed to check current page:', error);
      this.updateStatus('Ready to extract profile data');
    }
  }

  populateForm(profileData) {
    this.currentProfileData = profileData;

    ['fullName', 'jobTitle', 'company', 'location', 'profileUrl'].forEach((fieldId) => {
      const element = document.getElementById(fieldId);
      if (element && profileData[fieldId]) {
        element.value = profileData[fieldId];
        element.classList.add('auto-filled');
        this.clearFieldError(fieldId);
      }
    });

    const profileUrlField = document.getElementById('profileUrl');
    if (profileUrlField) profileUrlField.value = profileData.profileUrl || '';

    this.displayProfilePicture(profileData.profilePicture);

    if (profileData.profileUrl) {
      this.loadExistingContact(profileData.profileUrl);
    }

    this.renderExtractionWarnings(profileData._validation);

    const v = profileData._validation;
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
        if (!state?.hasDeviceKey) {
          this.showAlert('Saved locally. Add a device key in settings to sync.', 'warning');
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

    ['email', 'phone'].forEach((field) => {
      const element = document.getElementById(field);
      if (element && !element.value.trim() && contact[field]) {
        this.setFormFieldValue(field, contact[field]);
      }
    });
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
    this.showAlert('Form cleared', 'success');
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
