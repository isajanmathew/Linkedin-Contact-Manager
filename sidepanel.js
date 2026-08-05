/**
 * Side panel functionality for LinkedIn to Airtable extension
 * Handles UI interactions, form management, and data persistence
 */

class SidePanelManager {
  constructor() {
    this.isLoading = false;
    this.currentProfileData = {};
    this.fieldMappings = {};
    this.defaultFieldMappings = {
      fullName: 'Name',
      jobTitle: 'Job Title',
      company: 'Company',
      location: 'Location',
      email: 'Email',
      phone: 'Phone',
      profileUrl: 'LinkedIn URL',
      profilePicture: 'Profile Picture',
      tags: 'Tags',
      notes: 'Notes',
      contactDate: 'Last Catchup',
      followUpDate: 'Follow Up On'
    };
    this.existingRecordId = null;
    this.airtableConfig = null;
    this.airtableTagOptions = []; // Tag options from Airtable multi-select
    this.tagsLoading = false;
    this.selectedTags = []; // Array of selected tag names for chips UI
    this.init();
  }

  /**
   * Initialize side panel
   */
  async init() {
    this.setupEventListeners();
    this.setupMessageListener();
    await this.loadConfiguration();
    await this.loadAirtableTagOptions();
    await this.checkCurrentPage();
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Configuration toggle
    document.getElementById('configToggle').addEventListener('click', () => {
      this.toggleConfiguration();
    });

    // Save configuration
    document.getElementById('saveConfig').addEventListener('click', () => {
      this.saveConfiguration();
    });

    // Test field mappings
    document.getElementById('testMappings').addEventListener('click', () => {
      this.testFieldMappings();
    });

    // Form submission
    document.getElementById('contactForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveContact();
    });

    // Clear form
    document.getElementById('clearForm').addEventListener('click', () => {
      this.clearForm();
    });

    // View in Airtable button
    document.getElementById('viewInAirtable')?.addEventListener('click', () => {
      this.openInAirtable();
    });

    // Real-time validation
    document.getElementById('fullName').addEventListener('blur', () => {
      this.validateField('fullName');
    });

    document.getElementById('email').addEventListener('blur', () => {
      this.validateField('email');
    });

    document.getElementById('followUpDate').addEventListener('blur', () => {
      this.validateField('followUpDate');
    });

    document.getElementById('followUpDate').addEventListener('change', () => {
      this.validateField('followUpDate');
    });

    // Auto-save configuration on input
    ['apiToken', 'baseId', 'tableId'].forEach(fieldId => {
      document.getElementById(fieldId).addEventListener('input', 
        this.debounce(() => this.saveConfiguration(), 1000)
      );
    });

    // Auto-save field mappings on input and update badges
    Object.keys(this.defaultFieldMappings).forEach(dataKey => {
      const mappingField = document.getElementById(`mapping-${dataKey}`);
      if (mappingField) {
        mappingField.addEventListener('input',
          this.debounce(async () => {
            await this.saveConfiguration();
            // Refresh field type badges after saving
            const config = await this.getCurrentConfig();
            if (config.apiToken && config.baseId && config.tableId) {
              const fieldsResult = await chrome.runtime.sendMessage({
                action: 'fetchAvailableFields',
                config: config
              });
              if (fieldsResult.success) {
                this.updateFieldTypeBadges(fieldsResult.fieldTypes);
              }
            }
          }, 1000)
        );
      }
    });

    // Tags chips UI event listeners
    document.getElementById('addTagBtn')?.addEventListener('click', () => {
      this.showTagsDropdown();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const container = document.getElementById('tagsContainer');
      const dropdown = document.getElementById('tagsDropdown');
      if (container && dropdown && !container.contains(e.target) && !dropdown.contains(e.target)) {
        this.hideTagsDropdown();
      }
    });

    // Refresh tags button
    document.getElementById('refreshTagsBtn')?.addEventListener('click', () => {
      this.loadAirtableTagOptions(true);
    });
  }

  /**
   * Setup message listener for background script communication
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  /**
   * Handle incoming messages
   */
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

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  }

  /**
   * Toggle configuration section visibility
   */
  toggleConfiguration() {
    const toggle = document.getElementById('configToggle');
    const content = document.getElementById('configContent');
    
    const isExpanded = content.classList.contains('expanded');
    
    if (isExpanded) {
      content.classList.remove('expanded');
      toggle.classList.remove('expanded');
    } else {
      content.classList.add('expanded');
      toggle.classList.add('expanded');
    }
  }

  /**
   * Load configuration from storage
   */
  async loadConfiguration() {
    try {
      const result = await chrome.storage.sync.get(['airtableConfig', 'fieldMappings']);
      
      if (result.airtableConfig) {
        const config = result.airtableConfig;
        document.getElementById('apiToken').value = config.apiToken || '';
        document.getElementById('baseId').value = config.baseId || '';
        document.getElementById('tableId').value = config.tableId || '';
      }

      // Load field mappings
      this.fieldMappings = result.fieldMappings || {};
      this.populateFieldMappings();
      
    } catch (error) {
      console.error('Failed to load configuration:', error);
      this.showAlert('Failed to load saved configuration', 'error');
    }
  }

  /**
   * Save configuration to storage
   */
  async saveConfiguration() {
    const config = {
      apiToken: document.getElementById('apiToken').value.trim(),
      baseId: document.getElementById('baseId').value.trim(),
      tableId: document.getElementById('tableId').value.trim()
    };

    // Collect field mappings
    const fieldMappings = {};
    Object.keys(this.defaultFieldMappings).forEach(dataKey => {
      const mappingField = document.getElementById(`mapping-${dataKey}`);
      if (mappingField && mappingField.value.trim()) {
        fieldMappings[dataKey] = mappingField.value.trim();
      }
    });

    try {
      await chrome.storage.sync.set({ 
        airtableConfig: config,
        fieldMappings: fieldMappings
      });
      
      this.fieldMappings = fieldMappings;
      
      // Test connection if all fields are filled
      if (config.apiToken && config.baseId && config.tableId) {
        this.updateStatus('Testing connection...', 'loading');
        
        const testResult = await chrome.runtime.sendMessage({
          action: 'testAirtableConnection',
          config: config
        });

        if (testResult.success) {
          // Fetch available fields to refresh schema cache and update UI
          const fieldsResult = await chrome.runtime.sendMessage({
            action: 'fetchAvailableFields',
            config: config
          });

          if (fieldsResult.success) {
            this.updateFieldTypeBadges(fieldsResult.fieldTypes);
          }

          // Reload tag options from Airtable
          await this.loadAirtableTagOptions();

          this.showAlert('Configuration saved and connection verified', 'success');
          this.updateStatus('Connected');
        } else {
          this.showAlert(`Configuration saved but connection failed: ${testResult.error}`, 'warning');
          this.updateStatus('Config saved');
        }
      } else {
        this.showAlert('Configuration saved', 'success');
        this.updateStatus('Config saved');
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      this.showAlert('Failed to save configuration', 'error');
      this.updateStatus('Error', 'error');
    }
  }

  /**
   * Populate field mapping inputs with saved values
   */
  populateFieldMappings() {
    Object.keys(this.defaultFieldMappings).forEach(dataKey => {
      const mappingField = document.getElementById(`mapping-${dataKey}`);
      if (mappingField) {
        const savedMapping = this.fieldMappings[dataKey];
        const defaultMapping = this.defaultFieldMappings[dataKey];
        mappingField.value = savedMapping || '';
        mappingField.placeholder = defaultMapping;
      }
    });
  }

  /**
   * Test field mappings with current profile data
   */
  async testFieldMappings() {
    try {
      const config = await this.getCurrentConfig();
      
      if (!config.apiToken || !config.baseId || !config.tableId) {
        this.showAlert('Please configure Airtable settings first', 'error');
        return;
      }

      // Use current profile data or sample data
      const testData = Object.keys(this.currentProfileData).length > 0
        ? this.currentProfileData
        : {
          fullName: 'Test User',
          jobTitle: 'Test Position',
          company: 'Test Company',
          location: 'Test Location',
          email: 'test@example.com',
          phone: '+1234567890',
          profileUrl: 'https://linkedin.com/in/test',
          profilePicture: 'https://via.placeholder.com/200',
          tags: 'test-tag',
          notes: 'Test notes'
        };

      this.updateStatus('Testing field mappings...', 'loading');
      
      const result = await chrome.runtime.sendMessage({
        action: 'testFieldMappings',
        data: testData,
        config: config,
        fieldMappings: this.fieldMappings
      });

      if (result.success) {
        this.showAlert('Field mappings are valid!', 'success');
        this.updateStatus('Mappings verified');
        this.clearAllMappingErrors();
      } else {
        this.showAlert(`Field mapping test failed: ${result.error}`, 'error');
        this.updateStatus('Mapping test failed', 'error');
        
        // Highlight specific field errors
        if (result.unknownFields && result.unknownFields.length > 0) {
          this.highlightUnknownFields(result.unknownFields);
        }
      }

    } catch (error) {
      console.error('Field mapping test error:', error);
      this.showAlert('Failed to test field mappings', 'error');
      this.updateStatus('Test failed', 'error');
    }
  }

  /**
   * Highlight unknown fields in the mapping interface
   */
  highlightUnknownFields(unknownFields) {
    unknownFields.forEach(fieldName => {
      // Find which mapping corresponds to this field name
      Object.keys(this.defaultFieldMappings).forEach(dataKey => {
        const mappingField = document.getElementById(`mapping-${dataKey}`);
        const errorDiv = document.getElementById(`mapping-${dataKey}-error`);

        if (mappingField && mappingField.value === fieldName) {
          mappingField.classList.add('error');
          if (errorDiv) {
            errorDiv.textContent = `Field "${fieldName}" not found in Airtable`;
            errorDiv.classList.add('visible');
          }
        }
      });
    });
  }

  /**
   * Highlight fields with type errors in the mapping interface
   */
  highlightFieldErrors(fieldErrors) {
    fieldErrors.forEach(({ field, error }) => {
      // Find which mapping corresponds to this field name
      Object.keys(this.defaultFieldMappings).forEach(dataKey => {
        const mappingField = document.getElementById(`mapping-${dataKey}`);
        const errorDiv = document.getElementById(`mapping-${dataKey}-error`);

        if (mappingField && mappingField.value === field) {
          mappingField.classList.add('error');
          if (errorDiv) {
            errorDiv.textContent = `${field}: ${error}`;
            errorDiv.classList.add('visible');
          }
        }
      });
      
      // Special handling for tags - highlight the tags container
      if (field.toLowerCase().includes('tag') || this.fieldMappings?.tags === field) {
        const tagsContainer = document.getElementById('tagsContainer');
        if (tagsContainer) {
          tagsContainer.style.borderColor = 'var(--error-color)';
          tagsContainer.style.boxShadow = '0 0 0 2px rgba(239, 68, 68, 0.2)';
        }
        // Also show error in the tags section
        const tagsError = document.getElementById('tagsError');
        if (tagsError) {
          tagsError.textContent = error;
          tagsError.classList.add('visible');
        }
      }
    });
  }

  /**
   * Clear all mapping error states
   */
  clearAllMappingErrors() {
    Object.keys(this.defaultFieldMappings).forEach(dataKey => {
      const mappingField = document.getElementById(`mapping-${dataKey}`);
      const errorDiv = document.getElementById(`mapping-${dataKey}-error`);
      
      if (mappingField) {
        mappingField.classList.remove('error');
      }
      if (errorDiv) {
        errorDiv.classList.remove('visible');
      }
    });
    
    // Also clear tags container error styling
    const tagsContainer = document.getElementById('tagsContainer');
    if (tagsContainer) {
      tagsContainer.style.borderColor = '';
      tagsContainer.style.boxShadow = '';
    }
    const tagsError = document.getElementById('tagsError');
    if (tagsError) {
      tagsError.classList.remove('visible');
    }
  }

  /**
   * Check current page and update status accordingly
   */
  async checkCurrentPage() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      if (!currentTab || !currentTab.url?.includes('linkedin.com/in/')) {
        this.updateStatus('Navigate to a LinkedIn profile');
        return;
      }

      this.updateStatus('Waiting for profile data...', 'loading');
      
      // Try to trigger profile extraction after a short delay
      setTimeout(async () => {
        try {
          const response = await chrome.tabs.sendMessage(currentTab.id, {
            action: 'extractProfile'
          });
          console.log('Manual extraction triggered:', response);
        } catch (error) {
          console.log('Could not trigger manual extraction:', error);
          // This is expected if content script isn't ready yet
        }
      }, 2000);
      
    } catch (error) {
      console.error('Failed to check current page:', error);
      this.updateStatus('Ready to extract profile data');
    }
  }

  /**
   * Populate form with extracted LinkedIn data
   */
  populateForm(profileData) {
    this.currentProfileData = profileData;

    // Auto-fill fields and mark them as auto-filled
    const autoFillFields = [
      'fullName', 'jobTitle', 'company', 'location', 'profileUrl'
    ];

    autoFillFields.forEach(fieldId => {
      const element = document.getElementById(fieldId);
      if (element && profileData[fieldId]) {
        element.value = profileData[fieldId];
        element.classList.add('auto-filled');

        // Clear any previous errors
        this.clearFieldError(fieldId);
      }
    });

    // Set readonly URL
    const profileUrlField = document.getElementById('profileUrl');
    if (profileUrlField) {
      profileUrlField.value = profileData.profileUrl || '';
    }

    // Handle profile picture display
    this.displayProfilePicture(profileData.profilePicture);

    // Check if this contact already exists in Airtable
    if (profileData.profileUrl) {
      this.checkIfContactExists(profileData.profileUrl);
    }

    // Render extraction validation warnings, if any
    this.renderExtractionWarnings(profileData._validation);

    const v = profileData._validation;
    if (v && v.warnings && v.warnings.length) {
      const errCount = v.warnings.filter(w => w.severity === 'error').length;
      const msg = errCount > 0
        ? `Profile extracted with ${errCount} problem${errCount === 1 ? '' : 's'} — please review`
        : `Profile extracted with ${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'}`;
      this.showAlert(msg, errCount > 0 ? 'error' : 'warning');
    } else {
      this.showAlert('Profile data extracted successfully', 'success');
    }
  }

  /**
   * Render a warning banner listing per-field extraction problems.
   * Also marks the offending inputs so the user's eye jumps to them.
   */
  renderExtractionWarnings(validation) {
    const existing = document.getElementById('extractionWarnings');
    if (existing) existing.remove();

    // Clear previous warning highlights
    document.querySelectorAll('.field-input.extraction-warning, .field-input.extraction-error')
      .forEach(el => el.classList.remove('extraction-warning', 'extraction-error'));

    if (!validation || !validation.warnings || !validation.warnings.length) return;

    const { warnings, confidence } = validation;
    const errors = warnings.filter(w => w.severity === 'error');
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
    warnings.forEach(w => {
      const li = document.createElement('li');
      li.className = `extraction-warnings__item extraction-warnings__item--${w.severity}`;
      const label = document.createElement('strong');
      label.textContent = this.humanizeField(w.field) + ': ';
      li.appendChild(label);
      li.appendChild(document.createTextNode(w.message));
      list.appendChild(li);

      // Highlight the corresponding input
      const input = document.getElementById(w.field);
      if (input) {
        input.classList.add(w.severity === 'error' ? 'extraction-error' : 'extraction-warning');
      }
    });
    banner.appendChild(list);

    // Insert above the form
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
      profilePicture: 'Profile Picture'
    };
    return map[field] || field;
  }



  /**
   * Display profile picture from extracted data
   */
  displayProfilePicture(pictureUrl) {
    const img = document.getElementById('profilePictureImg');
    const placeholder = document.getElementById('profilePicturePlaceholder');
    const loading = document.getElementById('profilePictureLoading');
    const status = document.getElementById('profilePictureStatus');

    if (!pictureUrl) {
      // No picture URL provided
      if (img) img.style.display = 'none';
      if (placeholder) placeholder.style.display = 'flex';
      if (loading) loading.style.display = 'none';
      if (status) {
        status.textContent = 'No profile picture found';
        status.className = 'profile-picture-status warning';
      }
      return;
    }

    // Show loading state
    if (placeholder) placeholder.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    if (status) status.className = 'profile-picture-status';

    // Set image source and handle load/error
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

  /**
   * Save contact to Airtable
   */
  async saveContact() {
    if (this.isLoading) return;

    try {
      // Validate form
      if (!this.validateForm()) {
        this.showAlert('Please fix the form errors before saving', 'error');
        return;
      }

      // Get configuration
      const configResult = await chrome.storage.sync.get(['airtableConfig']);
      
      if (!configResult.airtableConfig) {
        this.showAlert('Please configure Airtable settings first', 'error');
        this.toggleConfiguration();
        return;
      }

      const config = configResult.airtableConfig;
      
      if (!config.apiToken || !config.baseId || !config.tableId) {
        this.showAlert('Airtable configuration is incomplete', 'error');
        this.toggleConfiguration();
        return;
      }

      // Collect form data
      const contactData = this.collectFormData();
      
      // Set loading state
      this.setLoadingState(true);
      this.updateStatus('Saving to Airtable...', 'loading');

      // Save to Airtable via background script
      const result = await chrome.runtime.sendMessage({
        action: 'saveToAirtable',
        data: contactData,
        config: config,
        fieldMappings: this.fieldMappings
      });

      if (result.success) {
        let alertMessage = result.message || 'Contact saved successfully!';

        // Show detailed info about excluded fields if any
        if (result.excludedFields && result.excludedFields.length > 0) {
          console.group('Excluded Fields');
          result.excludedFields.forEach(excluded => {
            console.warn(`Field "${excluded.field}" excluded: ${excluded.reason}`);
            if (excluded.expectedType) {
              console.log(`  Expected type: ${excluded.expectedType}`);
            }
          });
          console.groupEnd();

          // Add excluded fields to alert message
          const fieldNames = result.excludedFields.map(f => f.field).join(', ');
          alertMessage += `\n\nExcluded fields: ${fieldNames}`;
        }

        this.showAlert(alertMessage, 'success');
        this.updateStatus('Saved successfully');

        // Update UI to show saved state - keep data visible for user confirmation
        this.existingRecordId = result.recordId;
        this.showSavedIndicator(true);
        this.updateSaveButton(true);
        
        // Notify content script to update the Add Contact button state
        this.notifyContentScriptContactSaved();
        
        // Refresh from Airtable to confirm what was saved
        if (this.currentProfileData?.profileUrl) {
          await this.checkIfContactExists(this.currentProfileData.profileUrl);
        }
      } else {
        let errorMessage = result.error || 'Failed to save contact';

        // Log detailed error info for debugging
        console.group('Save Contact Error');
        console.error('Error Message:', result.error);
        if (result.fieldErrors) {
          console.error('Field Errors:', JSON.stringify(result.fieldErrors, null, 2));
        }
        if (result.unknownFields) {
          console.error('Unknown Fields:', JSON.stringify(result.unknownFields, null, 2));
        }
        console.groupEnd();

        // Handle field-specific errors
        if (result.fieldErrors && result.fieldErrors.length > 0) {
          const fieldNames = result.fieldErrors.map(fe => fe.field).join(', ');

          if (result.fieldErrors.length === 1) {
            errorMessage += `\n\nProblem with field: ${fieldNames}`;
          } else {
            errorMessage += `\n\nProblems with fields: ${fieldNames}`;
          }

          this.highlightFieldErrors(result.fieldErrors);
        }

        // Handle field mapping errors specifically
        if (result.unknownFields && result.unknownFields.length > 0) {
          const fieldList = result.unknownFields.join(', ');
          errorMessage += `\n\nThe following field(s) don't exist in your Airtable table: ${fieldList}`;
          errorMessage += '\n\nPlease update your field mappings in the configuration section.';
          this.highlightUnknownFields(result.unknownFields);
        }

        this.showAlert(errorMessage, 'error');
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

  /**
   * Collect all form data with tag validation
   */
  collectFormData() {
    // Tags are now stored in this.selectedTags array
    // Filter to only valid strings and match against Airtable options (case-insensitive, return exact casing)
    const validTags = this.selectedTags
      .filter(tag => typeof tag === 'string' && tag.trim())
      .map(tag => {
        // Find exact match from Airtable options to ensure correct casing
        const match = this.airtableTagOptions.find(opt => opt.name.toLowerCase() === tag.toLowerCase());
        return match ? match.name : tag.trim();
      })
      .filter(tag => this.airtableTagOptions.some(opt => opt.name.toLowerCase() === tag.toLowerCase()));
    
    console.log('[DEBUG] collectFormData - selectedTags:', [...this.selectedTags]);
    console.log('[DEBUG] collectFormData - validTags for Airtable:', validTags);
    
    return {
      fullName: document.getElementById('fullName').value.trim(),
      jobTitle: document.getElementById('jobTitle').value.trim(),
      company: document.getElementById('company').value.trim(),
      location: document.getElementById('location').value.trim(),
      profileUrl: document.getElementById('profileUrl').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      tags: validTags,
      notes: document.getElementById('notes').value.trim(),
      profilePicture: this.currentProfileData.profilePicture || '',
      contactDate: document.getElementById('contactDate').value.trim(),
      followUpDate: document.getElementById('followUpDate').value.trim()
    };
  }

  /**
   * Validate form fields
   */
  validateForm() {
    let isValid = true;

    // Validate required fields
    isValid = this.validateField('fullName') && isValid;

    // Validate email format if provided
    const email = document.getElementById('email').value.trim();
    if (email && !this.isValidEmail(email)) {
      this.showFieldError('email', 'Please enter a valid email address');
      isValid = false;
    } else {
      this.clearFieldError('email');
    }

    // Validate follow-up date if provided
    const followUpDate = document.getElementById('followUpDate').value.trim();
    if (followUpDate) {
      isValid = this.validateField('followUpDate') && isValid;
    }

    return isValid;
  }

  /**
   * Validate individual field
   */
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

  /**
   * Show field validation error
   */
  showFieldError(fieldId, message) {
    const errorElement = document.getElementById(`${fieldId}Error`);
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.add('visible');
    }
    
    const field = document.getElementById(fieldId);
    if (field) {
      field.style.borderColor = 'var(--error-color)';
    }
  }

  /**
   * Clear field validation error
   */
  clearFieldError(fieldId) {
    const errorElement = document.getElementById(`${fieldId}Error`);
    if (errorElement) {
      errorElement.classList.remove('visible');
    }
    
    const field = document.getElementById(fieldId);
    if (field) {
      field.style.borderColor = '';
    }
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Check if contact already exists in Airtable
   */
  async checkIfContactExists(profileUrl) {
    try {
      const configResult = await chrome.storage.sync.get(['airtableConfig']);
      if (!configResult.airtableConfig?.apiToken) return;
      
      // Store config for View in Airtable button
      this.airtableConfig = configResult.airtableConfig;
      
      const result = await chrome.runtime.sendMessage({
        action: 'checkExistingContact',
        profileUrl: profileUrl,
        config: configResult.airtableConfig,
        fieldMappings: this.fieldMappings
      });
      
      if (result.exists) {
        this.existingRecordId = result.recordId;
        this.showSavedIndicator(true);
        this.updateSaveButton(true);
        
        // Populate form with existing Airtable data
        if (result.existingData) {
          this.populateWithExistingData(result.existingData);
        }
      } else {
        this.existingRecordId = null;
        this.showSavedIndicator(false);
        this.updateSaveButton(false);
      }
    } catch (error) {
      console.log('Could not check existing contact:', error);
    }
  }

  /**
   * Populate form fields with existing data from Airtable
   * Uses existing Airtable data for user-entered fields (notes, tags, follow-up)
   * while keeping scraped data for profile info
   */
  populateWithExistingData(existingData) {
    // Use effective field mappings (defaults + user overrides)
    const effectiveMappings = { ...this.defaultFieldMappings, ...this.fieldMappings };
    
    // Create reverse mapping: Airtable field name -> form field id
    const reverseMapping = {};
    for (const [formField, airtableField] of Object.entries(effectiveMappings)) {
      reverseMapping[airtableField] = formField;
    }
    
    console.log('[DEBUG] populateWithExistingData - effectiveMappings:', effectiveMappings);
    console.log('[DEBUG] populateWithExistingData - reverseMapping:', reverseMapping);
    console.log('[DEBUG] populateWithExistingData - existingData:', existingData);

    // Fields that should be populated from existing Airtable data (user-entered fields)
    const userEnteredFields = ['notes', 'tags', 'followUpDate', 'contactDate'];
    
    // Also populate email/phone if scraped values are empty
    const conditionalFields = ['email', 'phone'];

    for (const [airtableField, value] of Object.entries(existingData)) {
      const formField = reverseMapping[airtableField];
      if (!formField || !value) continue;

      // Handle user-entered fields - always use existing data
      if (userEnteredFields.includes(formField)) {
        this.setFormFieldValue(formField, value);
      }
      
      // Handle conditional fields - use existing if scraped is empty
      if (conditionalFields.includes(formField)) {
        const currentElement = document.getElementById(formField);
        const currentValue = currentElement?.value?.trim();
        if (!currentValue) {
          this.setFormFieldValue(formField, value);
        }
      }
    }
  }

  /**
   * Set a form field's value based on field type
   */
  setFormFieldValue(formField, value) {
    if (formField === 'tags') {
      // Tags come as array from Airtable - populate selectedTags and render chips
      this.selectedTags = Array.isArray(value) ? [...value] : value.split(',').map(t => t.trim()).filter(Boolean);
      this.renderTagChips();
      // Update hidden input
      const hiddenInput = document.getElementById('tags');
      if (hiddenInput) {
        hiddenInput.value = this.selectedTags.join(', ');
      }
      return;
    }

    const element = document.getElementById(formField);
    if (!element) return;

    if (formField === 'followUpDate' || formField === 'contactDate') {
      // Date fields - ensure proper format (YYYY-MM-DD)
      if (value) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          element.value = date.toISOString().split('T')[0];
        }
      }
    } else {
      // Text fields
      element.value = value;
    }
  }

  /**
   * Show/hide the saved indicator badge
   */
  showSavedIndicator(show) {
    const indicator = document.getElementById('savedIndicator');
    if (indicator) {
      indicator.style.display = show ? 'inline-block' : 'none';
    }
  }

  /**
   * Update save button text based on update/create mode
   */
  updateSaveButton(isUpdate) {
    const saveBtn = document.getElementById('saveContact');
    const btnText = saveBtn?.querySelector('.btn__text');
    if (btnText) {
      btnText.textContent = isUpdate ? 'Update Contact' : 'Save Contact';
    }
  }

  /**
   * Notify the content script that a contact was saved (to update the floating button)
   */
  notifyContentScriptContactSaved() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'contactSaved' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Could not notify content script:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  }

  /**
   * Open the existing record in Airtable
   */
  openInAirtable() {
    if (!this.existingRecordId || !this.airtableConfig) {
      this.showAlert('Unable to open Airtable record', 'error');
      return;
    }
    
    const { baseId, tableId } = this.airtableConfig;
    const airtableUrl = `https://airtable.com/${baseId}/${tableId}/${this.existingRecordId}`;
    
    window.open(airtableUrl, '_blank');
  }

  /**
   * Clear manual entry fields only
   */
  clearManualFields() {
    const manualFields = ['email', 'phone', 'notes', 'contactDate', 'followUpDate'];

    manualFields.forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) {
        field.value = '';
      }
    });

    // Clear tags chips
    this.selectedTags = [];
    this.renderTagChips();
    const hiddenInput = document.getElementById('tags');
    if (hiddenInput) hiddenInput.value = '';
  }

  /**
   * Clear entire form
   */
  clearForm() {
    const form = document.getElementById('contactForm');
    if (form) {
      form.reset();

      // Remove auto-filled styling
      form.querySelectorAll('.auto-filled').forEach(field => {
        field.classList.remove('auto-filled');
      });

      // Clear all errors
      form.querySelectorAll('.field-error').forEach(error => {
        error.classList.remove('visible');
      });

      // Reset field borders
      form.querySelectorAll('.field-input, .field-textarea').forEach(field => {
        field.style.borderColor = '';
      });
    }

    // Reset profile picture display
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
    this.existingRecordId = null;
    this.airtableConfig = null;
    this.selectedTags = [];
    this.renderTagChips();
    this.showSavedIndicator(false);
    this.updateSaveButton(false);
    this.showAlert('Form cleared', 'success');
  }

  /**
   * Set loading state for save button
   */
  setLoadingState(loading) {
    this.isLoading = loading;
    const saveButton = document.getElementById('saveContact');
    const spinner = document.getElementById('saveSpinner');

    if (loading) {
      saveButton.classList.add('loading');
      saveButton.disabled = true;
    } else {
      saveButton.classList.remove('loading');
      saveButton.disabled = false;
    }
  }

  /**
   * Update status indicator
   */
  updateStatus(text, type = 'ready') {
    const statusText = document.querySelector('.status-text');
    const statusDot = document.querySelector('.status-dot');

    if (statusText) {
      statusText.textContent = text;
    }

    if (statusDot) {
      statusDot.className = 'status-dot';
      if (type === 'loading') {
        statusDot.classList.add('loading');
      } else if (type === 'error') {
        statusDot.classList.add('error');
      }
    }
  }

  /**
   * Show alert message
   */
  showAlert(message, type = 'success') {
    const alertElement = document.getElementById('alertMessage');
    
    if (alertElement) {
      alertElement.textContent = message;
      alertElement.className = `alert alert--${type} visible`;

      // Auto-hide after 4 seconds
      setTimeout(() => {
        alertElement.classList.remove('visible');
      }, 4000);
    }
  }

  /**
   * Debounce function for auto-save
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Utility function to sanitize input
   */
  sanitizeInput(input) {
    if (typeof input !== 'string') return '';

    const div = document.createElement('div');
    div.textContent = input;
    const sanitized = div.innerHTML;

    return sanitized
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  }

  /**
   * Update field type badges based on Airtable schema
   */
  updateFieldTypeBadges(fieldTypes) {
    if (!fieldTypes) return;

    // Define compatibility rules for each data field
    const dataFieldCompatibility = {
      fullName: ['singleLineText', 'multilineText', 'richText'],
      jobTitle: ['singleLineText', 'multilineText', 'richText'],
      company: ['singleLineText', 'multilineText', 'richText'],
      location: ['singleLineText', 'multilineText', 'richText'],
      profileUrl: ['url', 'singleLineText', 'multilineText'],
      profilePicture: ['url', 'multipleAttachments', 'singleLineText'],
      email: ['email', 'singleLineText', 'multilineText'],
      phone: ['phoneNumber', 'singleLineText', 'multilineText'],
      tags: ['multipleSelects', 'singleSelect', 'singleLineText', 'multilineText'],
      notes: ['multilineText', 'richText', 'singleLineText'],
      contactDate: ['date', 'dateTime', 'singleLineText'],
      followUpDate: ['date', 'dateTime', 'singleLineText']
    };

    // Update each field mapping badge
    Object.keys(this.defaultFieldMappings).forEach(dataKey => {
      const mappingField = document.getElementById(`mapping-${dataKey}`);
      const badgeElement = document.getElementById(`mapping-${dataKey}-type`);

      if (!mappingField || !badgeElement) return;

      const airtableFieldName = mappingField.value.trim() || this.defaultFieldMappings[dataKey];
      const fieldType = fieldTypes[airtableFieldName];

      if (!fieldType) {
        // Field not found in Airtable
        if (mappingField.value.trim()) {
          badgeElement.textContent = 'Not Found';
          badgeElement.className = 'field-type-badge incompatible';
          badgeElement.style.display = 'inline-block';
        } else {
          badgeElement.style.display = 'none';
        }
        return;
      }

      // Check compatibility
      const compatibleTypes = dataFieldCompatibility[dataKey] || [];
      const isCompatible = compatibleTypes.includes(fieldType);

      // Format field type for display
      const displayType = this.formatFieldType(fieldType);

      badgeElement.textContent = displayType;
      badgeElement.className = `field-type-badge ${isCompatible ? 'compatible' : 'warning'}`;
      badgeElement.style.display = 'inline-block';
    });
  }

  /**
   * Format Airtable field type for display
   */
  formatFieldType(fieldType) {
    const typeMap = {
      singleLineText: 'Text',
      multilineText: 'Long Text',
      richText: 'Rich Text',
      url: 'URL',
      email: 'Email',
      phoneNumber: 'Phone',
      multipleSelects: 'Multi-Select',
      singleSelect: 'Single Select',
      multipleAttachments: 'Attachment',
      multipleRecordLinks: 'Linked Record',
      number: 'Number',
      currency: 'Currency',
      percent: 'Percent',
      checkbox: 'Checkbox',
      date: 'Date',
      dateTime: 'Date Time',
      rating: 'Rating'
    };

    return typeMap[fieldType] || fieldType;
  }
}

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  new SidePanelManager();
});

// Extension of SidePanelManager class with additional methods
Object.assign(SidePanelManager.prototype, {
  /**
   * Get current configuration
   */
  async getCurrentConfig() {
    const result = await chrome.storage.sync.get(['airtableConfig', 'fieldMappings']);
    return {
      ...result.airtableConfig,
      fieldMappings: result.fieldMappings || {}
    };
  },

  /**
   * Load tag options from Airtable multi-select field
   */
  async loadAirtableTagOptions(forceRefresh = false) {
    const tagsHint = document.getElementById('tagsHint');
    const totalTagsElement = document.getElementById('totalTags');
    const dropdownEmpty = document.getElementById('tagsDropdownEmpty');
    
    try {
      const config = await this.getCurrentConfig();
      
      if (!config.apiToken || !config.baseId || !config.tableId) {
        if (tagsHint) {
          tagsHint.textContent = 'Configure Airtable connection to load tags.';
        }
        if (totalTagsElement) {
          totalTagsElement.textContent = '0';
        }
        this.airtableTagOptions = [];
        this.renderTagChips();
        return;
      }
      
      this.tagsLoading = true;
      if (dropdownEmpty) {
        dropdownEmpty.textContent = 'Loading tags from Airtable...';
      }
      
      const result = await chrome.runtime.sendMessage({
        action: 'fetchTagOptions',
        config: config,
        fieldMappings: config.fieldMappings
      });
      
      this.tagsLoading = false;
      
      if (result.success) {
        this.airtableTagOptions = result.options;
        
        if (totalTagsElement) {
          totalTagsElement.textContent = result.options.length.toString();
        }
        
        if (result.options.length === 0) {
          if (tagsHint) {
            tagsHint.textContent = 'No tags configured in Airtable. Add options to your Tags multi-select field.';
          }
        } else {
          if (tagsHint) {
            tagsHint.textContent = 'Tags are synced from Airtable. To add new tags, create them in Airtable first.';
          }
          
          if (forceRefresh) {
            this.showAlert(`Loaded ${result.options.length} tags from Airtable`, 'success');
          }
        }
        
        // Re-render chips in case tag colors updated
        this.renderTagChips();
      } else {
        console.warn('Failed to load tag options:', result.error);
        this.airtableTagOptions = [];
        
        if (result.fieldNotFound) {
          if (tagsHint) {
            tagsHint.textContent = `Tags field not found. Check your field mapping.`;
          }
        } else if (result.wrongFieldType) {
          if (tagsHint) {
            tagsHint.textContent = `Tags field must be Multi-select type in Airtable (current: ${result.actualType}).`;
          }
        } else {
          if (tagsHint) {
            tagsHint.textContent = `Could not load tags: ${result.error}`;
          }
        }
        
        if (totalTagsElement) {
          totalTagsElement.textContent = '0';
        }
      }
    } catch (error) {
      console.error('Error loading tag options:', error);
      this.tagsLoading = false;
      this.airtableTagOptions = [];
      
      if (tagsHint) {
        tagsHint.textContent = 'Error loading tags. Check your connection.';
      }
    }
  },

  /**
   * Render selected tags as chips
   */
  renderTagChips() {
    const chipsContainer = document.getElementById('tagsChips');
    const hiddenInput = document.getElementById('tags');
    
    if (!chipsContainer) return;

    // Clear and build chips using DOM APIs to avoid HTML encoding issues
    chipsContainer.innerHTML = '';
    
    this.selectedTags.forEach((tag, index) => {
      const tagInfo = this.airtableTagOptions.find(t => t.name === tag);
      const color = tagInfo?.color || 'blueLight2';
      const bgColor = this.getTagColor(color);
      const textColor = this.getTagTextColor(color);
      
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.style.backgroundColor = bgColor;
      chip.style.color = textColor;
      
      const textNode = document.createTextNode(tag);
      chip.appendChild(textNode);
      
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-chip__remove';
      removeBtn.title = 'Remove tag';
      removeBtn.textContent = '✕';
      removeBtn.dataset.tagIndex = index.toString();
      
      // Use direct reference to avoid HTML encoding issues
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeTag(tag); // Use raw tag name directly
      });
      
      chip.appendChild(removeBtn);
      chipsContainer.appendChild(chip);
    });
    
    // Update hidden input for form submission
    if (hiddenInput) {
      hiddenInput.value = this.selectedTags.join(', ');
    }
  },

  /**
   * Show dropdown with available (unselected) tags
   */
  showTagsDropdown() {
    const dropdown = document.getElementById('tagsDropdown');
    const emptyEl = document.getElementById('tagsDropdownEmpty');
    const contentEl = document.getElementById('tagsDropdownContent');
    
    if (!dropdown) return;

    if (this.tagsLoading) {
      if (emptyEl) {
        emptyEl.textContent = 'Loading tags from Airtable...';
        emptyEl.style.display = 'block';
      }
      if (contentEl) contentEl.innerHTML = '';
      dropdown.classList.add('visible');
      return;
    }

    const availableToSelect = this.airtableTagOptions.filter(
      tag => !this.selectedTags.includes(tag.name)
    );
    
    if (availableToSelect.length === 0) {
      if (emptyEl) {
        if (this.airtableTagOptions.length === 0) {
          emptyEl.textContent = 'No tags available. Add tags in Airtable first.';
        } else {
          emptyEl.textContent = 'All tags selected';
        }
        emptyEl.style.display = 'block';
      }
      if (contentEl) contentEl.innerHTML = '';
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      
      // Build dropdown items using DOM APIs to avoid HTML encoding issues
      if (contentEl) contentEl.innerHTML = '';
      
      availableToSelect.slice(0, 20).forEach((tag, index) => {
        const bgColor = this.getTagColor(tag.color || 'blueLight2');
        
        const item = document.createElement('div');
        item.className = 'tags-dropdown-item';
        item.dataset.tagIndex = index.toString();
        
        const colorDot = document.createElement('span');
        colorDot.className = 'tag-color-dot';
        colorDot.style.backgroundColor = bgColor;
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'tags-dropdown-item__name';
        nameSpan.textContent = tag.name; // Raw text, no encoding
        
        item.appendChild(colorDot);
        item.appendChild(nameSpan);
        
        // Attach click handler with direct reference to tag name
        item.addEventListener('click', () => {
          this.addTag(tag.name); // Use raw tag.name directly
        });
        
        if (contentEl) contentEl.appendChild(item);
      });
      
      if (availableToSelect.length > 20) {
        const moreEl = document.createElement('div');
        moreEl.className = 'tags-dropdown__more';
        moreEl.textContent = `+${availableToSelect.length - 20} more tags...`;
        if (contentEl) contentEl.appendChild(moreEl);
      }
    }
    
    dropdown.classList.add('visible');
  },

  /**
   * Hide tags dropdown
   */
  hideTagsDropdown() {
    const dropdown = document.getElementById('tagsDropdown');
    if (dropdown) {
      dropdown.classList.remove('visible');
    }
  },

  /**
   * Add a tag to selection
   */
  addTag(tagName) {
    // Validate tagName is a non-empty string
    if (typeof tagName !== 'string' || !tagName.trim()) {
      console.warn('[DEBUG] addTag: Invalid tagName:', tagName);
      return;
    }
    
    // Normalize: find exact match from Airtable options (case-insensitive lookup, exact casing stored)
    const normalizedTag = this.airtableTagOptions.find(
      opt => opt.name.toLowerCase() === tagName.toLowerCase()
    )?.name || tagName.trim();
    
    if (!this.selectedTags.includes(normalizedTag)) {
      this.selectedTags.push(normalizedTag);
      console.log('[DEBUG] addTag: Added tag, selectedTags now:', [...this.selectedTags]);
      this.renderTagChips();
    }
    this.hideTagsDropdown();
  },

  /**
   * Remove a tag from selection
   */
  removeTag(tagName) {
    this.selectedTags = this.selectedTags.filter(t => t !== tagName);
    this.renderTagChips();
  },

  /**
   * Get background color for Airtable tag color
   */
  getTagColor(airtableColor) {
    const colorMap = {
      blueLight1: '#9cc7ff',
      blueLight2: '#cfdfff',
      blueBright: '#2d7ff9',
      blueDark1: '#2750ae',
      cyanLight1: '#77d1f3',
      cyanLight2: '#d0f0fd',
      cyanBright: '#18bfff',
      cyanDark1: '#0b76b7',
      greenLight1: '#93e088',
      greenLight2: '#d1f7c4',
      greenBright: '#20c933',
      greenDark1: '#338a17',
      yellowLight1: '#ffd66e',
      yellowLight2: '#ffeab6',
      yellowBright: '#fcb400',
      yellowDark1: '#b87503',
      orangeLight1: '#ffa981',
      orangeLight2: '#fee2d5',
      orangeBright: '#ff6f2c',
      orangeDark1: '#d74d26',
      redLight1: '#ff9eb7',
      redLight2: '#ffdce5',
      redBright: '#f82b60',
      redDark1: '#ba1e45',
      pinkLight1: '#f99de2',
      pinkLight2: '#ffdaf6',
      pinkBright: '#ff08c2',
      pinkDark1: '#b2158b',
      purpleLight1: '#cdb0ff',
      purpleLight2: '#ede2fe',
      purpleBright: '#8b46ff',
      purpleDark1: '#6b1cb0',
      grayLight1: '#b8b8b8',
      grayLight2: '#eeeeee',
      grayBright: '#666666',
      grayDark1: '#444444',
      tealLight1: '#72ddc3',
      tealLight2: '#c2f5e9',
      tealBright: '#20d9d2',
      tealDark1: '#06a09b'
    };
    return colorMap[airtableColor] || '#cfdfff';
  },

  /**
   * Get text color for Airtable tag color (dark or light)
   */
  getTagTextColor(airtableColor) {
    // Dark colors need white text
    const darkColors = ['blueBright', 'blueDark1', 'cyanBright', 'cyanDark1', 'greenBright', 'greenDark1', 
      'yellowDark1', 'orangeBright', 'orangeDark1', 'redBright', 'redDark1', 
      'pinkBright', 'pinkDark1', 'purpleBright', 'purpleDark1', 'grayBright', 'grayDark1', 
      'tealBright', 'tealDark1'];
    
    if (darkColors.includes(airtableColor)) {
      return '#ffffff';
    }
    return '#1f2937';
  },

  /**
   * Escape HTML for safe rendering
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});