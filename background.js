/**
 * Background service worker for the LinkedIn to Airtable extension
 * Handles side panel management and cross-script communication
 */

// Production mode toggle - set to true for Chrome Web Store release
const IS_PRODUCTION = false;
const log = IS_PRODUCTION ? () => {} : console.log.bind(console);
const warn = IS_PRODUCTION ? () => {} : console.warn.bind(console);
const error = console.error.bind(console); // Always log errors

class BackgroundService {
  constructor() {
    this.init();
  }

  /**
   * Initialize background service
   */
  init() {
    this.setupMessageListener();
    this.setupTabListener();
    this.setupActionListener();
  }

  /**
   * Setup message listener for communication between scripts
   */
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  /**
   * Handle incoming messages
   */
  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case "saveToAirtable":
          const result = await this.saveToAirtable(request.data, request.config, request.fieldMappings);
          sendResponse(result);
          break;

        case "testAirtableConnection":
          const testResult = await this.testAirtableConnection(request.config);
          sendResponse(testResult);
          break;

        case "testFieldMappings":
          const mappingResult = await this.testFieldMappings(request.data, request.config, request.fieldMappings);
          sendResponse(mappingResult);
          break;

        case "fetchAvailableFields":
          const fieldsResult = await this.fetchAvailableFields(request.config);
          sendResponse(fieldsResult);
          break;

        case "fetchTagOptions":
          const tagOptionsResult = await this.fetchTagOptions(request.config, request.fieldMappings);
          sendResponse(tagOptionsResult);
          break;

        case "checkExistingContact":
          try {
            const existingRecord = await this.findExistingRecord(request.profileUrl, request.config, request.fieldMappings);
            sendResponse({
              exists: !!existingRecord,
              recordId: existingRecord?.id || null,
              existingData: existingRecord?.fields || null,
            });
          } catch (error) {
            sendResponse({ exists: false, error: error.message });
          }
          break;

        case "checkContactExists":
          // Lightweight check for the floating button - uses stored config
          try {
            const storedConfig = await this.getStoredConfig();
            if (!storedConfig || !storedConfig.apiToken || !storedConfig.baseId || !storedConfig.tableId) {
              sendResponse({ exists: false, configured: false });
              break;
            }
            const storedMappings = await this.getStoredFieldMappings();
            const record = await this.findExistingRecord(request.profileUrl, storedConfig, storedMappings);
            sendResponse({ exists: !!record, configured: true, recordId: record?.id || null });
          } catch (error) {
            sendResponse({ exists: false, configured: true, error: error.message });
          }
          break;

        case "openSidePanelFromButton":
          // Open side panel when Add Contact button is clicked
          try {
            if (sender.tab && sender.tab.id) {
              await this.openSidePanel(sender.tab.id);
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: "No tab context" });
            }
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        default:
          sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (error) {
      console.error("Background service error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Setup tab update listener to handle navigation
   */
  setupTabListener() {
    // Tab listener removed - side panel only opens on user gesture
    // This prevents the "sidePanel.open() may only be called in response to a user gesture" error
  }

  /**
   * Setup action listener for extension icon clicks
   */
  setupActionListener() {
    chrome.action.onClicked.addListener(async (tab) => {
      await this.openSidePanel(tab.id);
    });
  }

  /**
   * Check if URL is a LinkedIn profile page
   */
  isLinkedInProfilePage(url) {
    return url && url.includes("linkedin.com/in/");
  }

  /**
   * Open side panel for the specified tab
   */
  async openSidePanel(tabId) {
    if (!tabId) return;

    try {
      await chrome.sidePanel.open({ tabId });
    } catch (error) {
      console.error("Failed to open side panel:", error);
    }
  }

  /**
   * Get stored Airtable configuration from Chrome storage
   */
  async getStoredConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['airtableConfig'], (result) => {
        resolve(result.airtableConfig || null);
      });
    });
  }

  /**
   * Get stored field mappings from Chrome storage
   */
  async getStoredFieldMappings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['fieldMappings'], (result) => {
        resolve(result.fieldMappings || {});
      });
    });
  }

  /**
   * Find existing record in Airtable by LinkedIn URL
   */
  async findExistingRecord(profileUrl, config, fieldMappings) {
    if (!profileUrl) return null;

    // Get the Airtable field name for LinkedIn URL
    const urlFieldName = fieldMappings?.profileUrl || "LinkedIn URL";

    // Build the filter formula to find matching record
    const filterFormula = encodeURIComponent(`{${urlFieldName}} = "${profileUrl}"`);
    const searchUrl = `https://api.airtable.com/v0/${config.baseId}/${config.tableId}?filterByFormula=${filterFormula}&maxRecords=1`;

    try {
      const response = await fetch(searchUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
        },
      });

      if (!response.ok) {
        console.warn("Failed to search for existing record:", response.status);
        return null;
      }

      const data = await response.json();
      if (data.records && data.records.length > 0) {
        const record = data.records[0];
        log("Found existing record:", record.id);
        return {
          id: record.id,
          fields: record.fields
        };
      }

      return null;
    } catch (error) {
      console.warn("Error searching for existing record:", error);
      return null;
    }
  }

  /**
   * Save contact data to Airtable (creates new or updates existing)
   */
  async saveToAirtable(contactData, config, fieldMappings = null) {
    // Use provided fieldMappings or fall back to default
    const mappings = fieldMappings || {};
    if (!config.apiToken || !config.baseId || !config.tableId) {
      return {
        success: false,
        error: "Airtable configuration is incomplete",
      };
    }

    // Check for existing record by LinkedIn URL
    const existingRecord = await this.findExistingRecord(contactData.profileUrl, config, mappings);
    const existingRecordId = existingRecord?.id || null;

    const isUpdate = !!existingRecordId;
    const url = isUpdate
      ? `https://api.airtable.com/v0/${config.baseId}/${config.tableId}/${existingRecordId}?typecast=true`
      : `https://api.airtable.com/v0/${config.baseId}/${config.tableId}?typecast=true`;
    const method = isUpdate ? "PATCH" : "POST";

    let responseData = null;
    let fields = {};
    let validFields = {};
    let excludedFields = [];

    try {
      // Fetch schema to ensure we have latest field types
      const schema = await this.fetchTableSchema(config);

      // Transform data for Airtable format
      fields = this.mapContactDataToAirtable(contactData, mappings);

      console.log("Mapped fields for Airtable (before transformation):", JSON.stringify(fields, null, 2));

      // Transform field values to match Airtable field types
      fields = await this.transformFieldsForAirtable(fields, config);

      console.log("Transformed fields for Airtable:", JSON.stringify(fields, null, 2));

      // Validate and filter fields based on schema
      const validationResult = this.validateAndFilterFields(fields, schema);
      validFields = validationResult.validFields;
      excludedFields = validationResult.excludedFields;

      console.log("Valid fields after validation:", JSON.stringify(validFields, null, 2));
      if (excludedFields.length > 0) {
        console.warn("Excluded fields due to validation issues:", excludedFields);
      }

      console.log("Final fields to send:", JSON.stringify(validFields, null, 2));
      console.log("Request URL:", url);
      console.log("Request body:", JSON.stringify({ fields: validFields }, null, 2));

      const response = await fetch(url, {
        method: method,
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: validFields,
        }),
      });

      // Always try to get response data, even if response is not ok
      try {
        responseData = await response.json();
      } catch (jsonError) {
        console.warn("Failed to parse response JSON:", jsonError);
        responseData = {};
      }

      if (!response.ok) {
        const errorInfo = this.parseAirtableError(
          new Error(`HTTP ${response.status}: ${response.statusText}`),
          responseData,
          fields,
        );

        return {
          success: false,
          error: errorInfo.message,
          unknownFields: errorInfo.unknownFields,
          fieldErrors: errorInfo.fieldErrors,
        };
      }

      // Build success message with exclusion info
      let message = isUpdate ? "Contact updated successfully in Airtable" : "Contact saved successfully to Airtable";
      if (excludedFields.length > 0) {
        message += ` (${excludedFields.length} field${excludedFields.length > 1 ? "s" : ""} excluded due to type mismatches)`;
      }

      return {
        success: true,
        recordId: responseData.id,
        message: message,
        isUpdate: isUpdate,
        excludedFields: excludedFields,
      };
    } catch (error) {
      console.error("Airtable save error:", error);

      // Provide specific error messages for common issues
      const errorInfo = this.parseAirtableError(error, responseData, validFields || fields);

      return {
        success: false,
        error: errorInfo.message,
        unknownFields: errorInfo.unknownFields,
        fieldErrors: errorInfo.fieldErrors,
      };
    }
  }

  /**
   * Test Airtable connection and configuration
   */
  async testAirtableConnection(config) {
    if (!config.apiToken || !config.baseId || !config.tableId) {
      return {
        success: false,
        error: "Please provide all required configuration fields",
      };
    }

    let responseData = null;

    try {
      const url = `https://api.airtable.com/v0/${config.baseId}/${config.tableId}?maxRecords=1`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
        },
      });

      // Always try to get response data
      try {
        responseData = await response.json();
      } catch (jsonError) {
        console.warn("Failed to parse test response JSON:", jsonError);
        responseData = {};
      }

      if (!response.ok) {
        let errorMessage = responseData.error?.message || `HTTP ${response.status}`;

        if (response.status === 401) {
          errorMessage = "Invalid API token";
        } else if (response.status === 404) {
          errorMessage = "Base or table not found";
        }

        return {
          success: false,
          error: errorMessage,
        };
      }

      return {
        success: true,
        message: "Airtable connection successful",
      };
    } catch (error) {
      console.error("Airtable test error:", error);

      let errorMessage = error.message;
      if (error.message.includes("401")) {
        errorMessage = "Invalid API token";
      } else if (error.message.includes("404")) {
        errorMessage = "Base or table not found";
      } else if (error.message.includes("Failed to fetch")) {
        errorMessage = "Network error. Please check your internet connection.";
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Map contact data to Airtable fields using user-defined mappings
   */
  mapContactDataToAirtable(contactData, fieldMappings) {
    const defaultMappings = {
      fullName: "Name",
      jobTitle: "Job Title",
      company: "Company",
      location: "Location",
      email: "Email",
      phone: "Phone",
      profileUrl: "LinkedIn URL",
      profilePicture: "Profile Picture",
      tags: "Tags",
      notes: "Notes",
      contactDate: "Last Catchup",
      followUpDate: "Follow Up On",
    };

    const mappings = { ...defaultMappings, ...fieldMappings };
    const fields = {};

    Object.keys(mappings).forEach((dataKey) => {
      const airtableField = mappings[dataKey];
      // Only include fields that have non-empty values
      if (airtableField && contactData[dataKey] && contactData[dataKey] !== "") {
        // Sanitize the data before mapping
        fields[airtableField] = this.sanitizeValue(contactData[dataKey]);
      } else if (airtableField && !contactData[dataKey]) {
        console.log(`Skipping field "${airtableField}" - no data for ${dataKey}`);
      }
    });

    return fields;
  }

  /**
   * Sanitize a single select option value (for multi-select/single-select fields)
   * Removes quotes, escaped quotes, and normalizes whitespace
   * Uses iterative approach to handle nested/multiple quote patterns
   */
  sanitizeSelectOption(value) {
    if (value === null || value === undefined) return null;
    
    // Convert to string if not already
    let sanitized = typeof value === 'string' ? value : String(value);
    sanitized = sanitized.trim();
    if (!sanitized) return null;
    
    // Iteratively strip surrounding quotes until stable
    let prev = '';
    while (prev !== sanitized) {
      prev = sanitized;
      // Remove escaped quotes at start/end: \"value\" or \'value\'
      sanitized = sanitized.replace(/^\\["']/, '').replace(/\\["']$/, '');
      // Remove regular quotes at start/end: "value" or 'value'
      sanitized = sanitized.replace(/^["']/, '').replace(/["']$/, '');
      sanitized = sanitized.trim();
    }
    
    // Normalize internal whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    return sanitized || null;
  }

  /**
   * Sanitize field values to ensure they're safe and valid
   */
  sanitizeValue(value) {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle strings
    if (typeof value === "string") {
      // Trim whitespace
      let sanitized = value.trim();

      // Remove surrounding quotes (both single and double)
      sanitized = sanitized.replace(/^["']|["']$/g, "");

      // Remove null bytes
      sanitized = sanitized.replace(/\0/g, "");

      // Remove excessive whitespace
      sanitized = sanitized.replace(/\s+/g, " ");

      // Limit length to prevent oversized data (Airtable has limits)
      const maxLength = 100000; // Airtable's max text length
      if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
      }

      return sanitized;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    // Handle objects (but not Dates)
    if (typeof value === "object" && !(value instanceof Date)) {
      const sanitized = {};
      Object.keys(value).forEach((key) => {
        sanitized[key] = this.sanitizeValue(value[key]);
      });
      return sanitized;
    }

    // Return other types as-is (numbers, booleans, dates)
    return value;
  }

  /**
   * Validate and filter fields based on Airtable schema
   */
  validateAndFilterFields(fields, schema) {
    const validFields = {};
    const excludedFields = [];

    for (const [fieldName, value] of Object.entries(fields)) {
      // Skip empty values
      if (value === null || value === undefined || value === "") {
        console.log(`Skipping empty field: ${fieldName}`);
        continue;
      }

      // If no schema available, include all fields
      if (!schema) {
        validFields[fieldName] = value;
        continue;
      }

      const fieldType = schema[fieldName];

      // Check if field exists in schema
      if (!fieldType) {
        console.warn(`Field "${fieldName}" not found in Airtable schema, excluding`);
        excludedFields.push({
          field: fieldName,
          reason: "Field does not exist in Airtable table",
          value: value,
        });
        continue;
      }

      // Special handling for linked record fields with empty/invalid values
      if (fieldType === "multipleRecordLinks") {
        // Check if value is appropriate for linked record field
        const isValidLinkedRecord =
          Array.isArray(value) &&
          value.length > 0 &&
          value.every((v) => typeof v === "string" && !v.startsWith("http"));

        if (!isValidLinkedRecord) {
          console.warn(`Field "${fieldName}" is a linked record field but has incompatible value. Excluding.`);
          excludedFields.push({
            field: fieldName,
            reason: "Linked record field requires array of record IDs, not URLs or text",
            expectedType: fieldType,
            actualValue: value,
          });
          continue;
        }
      }

      // Validate field value against type
      const validationResult = this.validateFieldValue(fieldName, value, fieldType);

      if (validationResult.isValid) {
        validFields[fieldName] = value;
      } else {
        console.warn(`Field "${fieldName}" excluded: ${validationResult.reason}`);
        excludedFields.push({
          field: fieldName,
          reason: validationResult.reason,
          expectedType: fieldType,
          actualValue: value,
        });
      }
    }

    return { validFields, excludedFields };
  }

  /**
   * Validate a field value against its expected Airtable type
   */
  validateFieldValue(fieldName, value, fieldType) {
    try {
      switch (fieldType) {
        case "multipleRecordLinks":
          // Must be an array of strings (record IDs)
          if (!Array.isArray(value)) {
            return {
              isValid: false,
              reason: `Expected array of record IDs for linked record field, got ${typeof value}`,
            };
          }
          // Check if all elements are strings
          if (!value.every((v) => typeof v === "string")) {
            return {
              isValid: false,
              reason: "All record IDs must be strings",
            };
          }
          return { isValid: true };

        case "multipleAttachments":
          // Must be an array of objects with url property
          if (!Array.isArray(value)) {
            return {
              isValid: false,
              reason: `Expected array of attachment objects, got ${typeof value}`,
            };
          }
          // Check if all elements have url property
          const allHaveUrl = value.every((v) => typeof v === "object" && v !== null && typeof v.url === "string");
          if (!allHaveUrl) {
            return {
              isValid: false,
              reason: "All attachments must be objects with url property",
            };
          }
          return { isValid: true };

        case "multipleSelects":
          // Must be an array of strings
          if (!Array.isArray(value)) {
            return {
              isValid: false,
              reason: `Expected array of strings for multi-select, got ${typeof value}`,
            };
          }
          return { isValid: true };

        case "singleSelect":
          // Must be a string
          if (typeof value !== "string") {
            return {
              isValid: false,
              reason: `Expected string for single select, got ${typeof value}`,
            };
          }
          return { isValid: true };

        case "number":
        case "currency":
        case "percent":
        case "rating":
          // Must be a number
          if (typeof value !== "number" || isNaN(value)) {
            return {
              isValid: false,
              reason: `Expected number, got ${typeof value}`,
            };
          }
          return { isValid: true };

        case "checkbox":
          // Must be a boolean
          if (typeof value !== "boolean") {
            return {
              isValid: false,
              reason: `Expected boolean, got ${typeof value}`,
            };
          }
          return { isValid: true };

        case "singleLineText":
        case "multilineText":
        case "richText":
        case "email":
        case "url":
        case "phoneNumber":
        case "date":
        case "dateTime":
          // Must be a string
          if (typeof value !== "string") {
            return {
              isValid: false,
              reason: `Expected string, got ${typeof value}`,
            };
          }
          return { isValid: true };

        default:
          // For unknown types, accept the value
          return { isValid: true };
      }
    } catch (error) {
      console.error(`Error validating field ${fieldName}:`, error);
      return {
        isValid: false,
        reason: `Validation error: ${error.message}`,
      };
    }
  }

  /**
   * Transform field values to match Airtable field types
   */
  async transformFieldsForAirtable(fields, config) {
    // Try to fetch table schema to understand field types
    const schema = await this.fetchTableSchema(config);

    const transformedFields = {};

    for (const [fieldName, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      // Get field type from schema if available
      const fieldType = schema ? schema[fieldName] : null;

      console.log(`Processing field: ${fieldName}, type: ${fieldType || "unknown"}, value:`, value);

      try {
        // Transform based on field type
        let transformedValue;
        if (fieldType) {
          transformedValue = this.transformByFieldType(fieldName, value, fieldType);
        } else {
          // Fallback to heuristic-based transformation
          transformedValue = this.transformByHeuristic(fieldName, value);
        }

        // Only include field if transformation didn't return null (null means exclude)
        if (transformedValue !== null) {
          transformedFields[fieldName] = transformedValue;
        } else {
          console.warn(`Field ${fieldName} excluded due to incompatible value type`);
        }
      } catch (error) {
        console.warn(`Failed to transform field ${fieldName}:`, error);
        // Keep original value if transformation fails
        transformedFields[fieldName] = value;
      }
    }

    return transformedFields;
  }

  /**
   * Transform value based on known Airtable field type
   */
  transformByFieldType(fieldName, value, fieldType) {
    console.log(`Transforming ${fieldName} as ${fieldType}`);

    switch (fieldType) {
      case "multipleAttachments":
        // Attachments must be an array of objects with url property
        if (typeof value === "string" && value.startsWith("http")) {
          return [{ url: value }];
        }
        if (Array.isArray(value)) {
          return value
            .map((v) => {
              if (typeof v === "string" && v.startsWith("http")) {
                return { url: v };
              }
              if (typeof v === "object" && v !== null && v.url) {
                return v;
              }
              return null;
            })
            .filter((v) => v !== null);
        }
        // Invalid format, return empty array to avoid errors
        console.warn(`Invalid attachment format for ${fieldName}, returning empty array`);
        return [];

      case "multipleRecordLinks":
        // Linked records must be an array of record ID strings
        // IMPORTANT: URLs are NOT valid record IDs - they should be excluded
        // Empty values should also be excluded to prevent "not an array" errors

        // Always exclude empty or undefined values
        if (!value || value === "" || (Array.isArray(value) && value.length === 0)) {
          console.warn(`Field "${fieldName}" is a linked record field but has no value. Excluding from payload.`);
          return null;
        }

        if (Array.isArray(value)) {
          // Filter to only valid record IDs (strings that are NOT URLs)
          const validIds = value.filter(
            (v) => typeof v === "string" && v.length > 0 && !v.startsWith("http://") && !v.startsWith("https://"),
          );
          if (validIds.length === 0) {
            console.warn(
              `Invalid linked record format for ${fieldName}: URLs cannot be used as record IDs. Field will be excluded.`,
            );
            return null; // Return null to trigger field exclusion
          }
          return validIds;
        }
        if (typeof value === "string" && value.length > 0) {
          // Check if it's a URL - if so, this is incompatible
          if (value.startsWith("http://") || value.startsWith("https://")) {
            console.warn(
              `Invalid value for linked record field "${fieldName}": URLs cannot be used as record IDs. Field will be excluded.`,
            );
            return null; // Return null to trigger field exclusion
          }
          // If it's a comma-separated list, split it
          if (value.includes(",")) {
            return value
              .split(",")
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
          }
          // Single record ID
          return [value];
        }
        // Invalid format, return null to exclude field
        console.warn(
          `Invalid linked record format for ${fieldName}, expected array of record IDs. Field will be excluded.`,
        );
        return null;

      case "multipleSelects":
        // Multi-select must be an array of unique, sanitized strings
        let selectValues = [];
        
        if (typeof value === "string") {
          selectValues = value.split(",").map((v) => this.sanitizeSelectOption(v)).filter((v) => v);
        } else if (Array.isArray(value)) {
          selectValues = value.map((v) => this.sanitizeSelectOption(v)).filter((v) => v);
        } else {
          const sanitized = this.sanitizeSelectOption(String(value));
          if (sanitized) selectValues = [sanitized];
        }
        
        // Ensure all values are strings and deduplicate
        selectValues = [...new Set(selectValues.filter(v => typeof v === 'string' && v.length > 0))];
        
        console.log(`[Tags] Sanitized values before validation: ${JSON.stringify(selectValues)}`);
        
        // Validate against Airtable's allowed choices if we have cached schema
        if (this.cachedSchema?.fieldDetails?.[fieldName]?.options?.choices) {
          const allowedChoices = this.cachedSchema.fieldDetails[fieldName].options.choices;
          const choiceMap = new Map(allowedChoices.map(c => [c.name.toLowerCase(), c.name]));
          
          console.log(`[Tags] Allowed choices from schema: ${allowedChoices.map(c => c.name).join(', ')}`);
          
          const validatedValues = [];
          const invalidValues = [];
          
          for (const val of selectValues) {
            const canonical = choiceMap.get(val.toLowerCase());
            if (canonical) {
              validatedValues.push(canonical);
            } else {
              invalidValues.push(val);
            }
          }
          
          // Deduplicate validated values (in case of case differences)
          const uniqueValidated = [...new Set(validatedValues)];
          
          if (invalidValues.length > 0) {
            console.warn(`[Tags] Invalid options not in Airtable: ${invalidValues.join(', ')}`);
          }
          
          console.log(`[Tags] Final validated values to send: ${JSON.stringify(uniqueValidated)}`);
          return uniqueValidated.length > 0 ? uniqueValidated : null;
        }
        
        console.log(`[Tags] No schema cache, using sanitized values: ${JSON.stringify(selectValues)}`);
        return selectValues.length > 0 ? selectValues : null;

      case "singleSelect":
        // Single select must be a single string
        let singleValue;
        if (Array.isArray(value)) {
          singleValue = value[0] ? String(value[0]) : "";
        } else {
          singleValue = String(value);
        }
        // Remove any surrounding quotes
        return singleValue.replace(/^["']+|["']+$/g, "").trim();

      case "multilineText":
      case "singleLineText":
      case "richText":
        // Text fields should be strings with quotes removed
        return String(value)
          .replace(/^["']+|["']+$/g, "")
          .trim();

      case "number":
      case "currency":
      case "percent":
      case "rating":
        // Numeric fields
        const num = parseFloat(value);
        return isNaN(num) ? null : num;

      case "checkbox":
        // Boolean fields
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
          return value.toLowerCase() === "true" || value === "1";
        }
        return Boolean(value);

      case "date":
      case "dateTime":
        // Date fields - Airtable accepts ISO 8601 format
        if (value instanceof Date) {
          return value.toISOString();
        }
        return String(value);

      case "url":
      case "email":
      case "phoneNumber":
        // These are text-based but with validation
        return String(value);

      default:
        // Unknown type, keep as-is
        return value;
    }
  }

  /**
   * Transform value based on field name heuristics when schema is not available
   */
  transformByHeuristic(fieldName, value) {
    const lowerName = fieldName.toLowerCase();

    // For URL fields (like picture URLs), just return as string
    // Let Airtable validate the URL format
    if (typeof value === "string" && value.startsWith("http")) {
      if (lowerName.includes("picture") || lowerName.includes("photo") || lowerName.includes("image")) {
        console.log(`Keeping ${fieldName} as plain URL string (heuristic)`);
        return String(value);
      }
    }

    // Handle tags/multi-select fields
    if (lowerName.includes("tag") || lowerName.includes("categor")) {
      if (typeof value === "string") {
        const items = value
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item);
        if (items.length > 1) {
          console.log(`Transformed ${fieldName} to multi-select array (heuristic)`);
          return items;
        } else if (items.length === 1) {
          console.log(`Transformed ${fieldName} to single value (heuristic)`);
          return items[0];
        }
      }
    }

    // Keep other values as-is
    return value;
  }

  /**
   * Fetch Airtable table schema to understand field types
   */
  async fetchTableSchema(config) {
    // Check if we have a cached schema that's less than 5 minutes old
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes
    const configKey = `${config.baseId}:${config.tableId}`;

    if (
      this.cachedSchema &&
      this.cachedSchema.configKey === configKey &&
      this.cachedSchema.timestamp &&
      Date.now() - this.cachedSchema.timestamp < cacheTimeout
    ) {
      console.log(
        "Using cached schema (age:",
        Math.floor((Date.now() - this.cachedSchema.timestamp) / 1000),
        "seconds)",
      );
      return this.cachedSchema.fieldTypes;
    }

    try {
      const url = `https://api.airtable.com/v0/meta/bases/${config.baseId}/tables`;

      console.log("Fetching Airtable schema from API...");

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
        },
      });

      if (!response.ok) {
        console.warn("Could not fetch table schema - HTTP", response.status);
        const errorData = await response.json().catch(() => ({}));
        console.warn("Schema fetch error details:", errorData);

        // Return cached schema if available, even if expired
        if (this.cachedSchema && this.cachedSchema.configKey === configKey) {
          console.log("Using expired cached schema as fallback");
          return this.cachedSchema.fieldTypes;
        }

        return null;
      }

      const data = await response.json();
      const table = data.tables?.find((t) => t.id === config.tableId || t.name === config.tableId);

      if (table && table.fields) {
        const fieldTypes = {};
        const fieldDetails = {};

        table.fields.forEach((field) => {
          fieldTypes[field.name] = field.type;
          fieldDetails[field.name] = {
            type: field.type,
            options: field.options || null,
          };
        });

        console.log("Successfully fetched table schema:");
        console.log("Field types:", fieldTypes);
        console.log("Available fields:", Object.keys(fieldTypes).join(", "));

        // Log specific field types for debugging
        if (fieldTypes["Profile Picture"]) {
          console.log("Profile Picture field type:", fieldTypes["Profile Picture"]);
        }

        // Store field details for validation with config key
        this.cachedSchema = {
          configKey: configKey,
          fieldTypes,
          fieldDetails,
          timestamp: Date.now(),
        };

        // Also store in chrome.storage for persistence
        try {
          await chrome.storage.local.set({
            [`airtableSchema_${configKey}`]: {
              fieldTypes,
              fieldDetails,
              timestamp: Date.now(),
            },
          });
        } catch (storageError) {
          console.warn("Could not cache schema in storage:", storageError);
        }

        return fieldTypes;
      }

      console.warn("Table not found in schema response");
      return null;
    } catch (error) {
      console.warn("Error fetching table schema:", error);

      // Try to load from chrome.storage as fallback
      try {
        const configKey = `${config.baseId}:${config.tableId}`;
        const result = await chrome.storage.local.get([`airtableSchema_${configKey}`]);
        const storedSchema = result[`airtableSchema_${configKey}`];

        if (storedSchema && storedSchema.fieldTypes) {
          console.log("Using schema from storage as fallback");
          this.cachedSchema = {
            configKey: configKey,
            ...storedSchema,
          };
          return storedSchema.fieldTypes;
        }
      } catch (storageError) {
        console.warn("Could not load schema from storage:", storageError);
      }

      return null;
    }
  }

  /**
   * Safely serialize objects for logging, handling circular references
   */
  safeStringify(obj, indent = 2) {
    const seen = new WeakSet();
    return JSON.stringify(
      obj,
      (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) {
            return "[Circular Reference]";
          }
          seen.add(value);
        }
        return value;
      },
      indent,
    );
  }

  /**
   * Parse Airtable API errors for specific field issues
   */
  parseAirtableError(error, responseData = null, sentFields = null) {
    let errorMessage = error.message;
    let unknownFields = [];
    let fieldErrors = [];

    console.group("🔴 Airtable Error Details");
    console.error("Error Message:", error.message);
    console.error("Error Stack:", error.stack);

    try {
      console.error("Response Data:", this.safeStringify(responseData));
      console.error("Sent Fields:", this.safeStringify(sentFields));
    } catch (stringifyError) {
      console.error("Response Data (raw):", responseData);
      console.error("Sent Fields (raw):", sentFields);
      console.warn("Could not stringify error data:", stringifyError.message);
    }

    // Log the actual Airtable error for debugging
    if (responseData && responseData.error) {
      console.error("Airtable API Error Type:", responseData.error.type || "Unknown");
      console.error("Airtable API Error Message:", responseData.error.message || "No message provided");

      try {
        console.error("Full Airtable Error:", this.safeStringify(responseData.error));
      } catch (e) {
        console.error("Full Airtable Error (raw):", responseData.error);
      }
    }
    console.groupEnd();

    // Parse response for field-specific errors
    if (responseData && typeof responseData === "object") {
      const airtableError = responseData.error;

      if (airtableError && typeof airtableError === "object") {
        const errorType = airtableError.type || "";
        const errorMsg = airtableError.message || "";

        if (errorType === "UNKNOWN_FIELD_NAME") {
          const fieldName = errorMsg.match(/"([^"]+)"/)?.[1];
          if (fieldName) {
            unknownFields.push(fieldName);
            fieldErrors.push({
              field: fieldName,
              error: "Field does not exist in Airtable table",
            });
            errorMessage = `Unknown field: "${fieldName}". Please check your field mappings in the configuration section.`;
          } else {
            errorMessage = `Unknown field error. ${errorMsg}`;
          }
        } else if (errorType === "INVALID_VALUE_FOR_COLUMN") {
          const fieldName = errorMsg.match(/field[s]?\s+["']?([^"'\s,]+)["']?/i)?.[1];

          // Check if error mentions specific types
          let typeHint = "";
          if (errorMsg.toLowerCase().includes("record id")) {
            typeHint =
              " The field appears to be a Linked Record type, but a URL was provided. Change the field type in Airtable to URL or Attachment.";
          } else if (errorMsg.toLowerCase().includes("array")) {
            typeHint = " The field expects an array format. Check the field type in Airtable.";
          }

          if (fieldName) {
            fieldErrors.push({
              field: fieldName,
              error: "Invalid data type for this field" + typeHint,
            });
            errorMessage = `Invalid data type for field "${fieldName}".${typeHint} Details: ${errorMsg}`;
          } else {
            errorMessage = `Invalid data type error. ${errorMsg}`;
          }
        } else if (errorType === "INVALID_MULTIPLE_CHOICE_OPTIONS") {
          // Extract field name from error message
          const fieldMatch = errorMsg.match(/create new select option.*?$/i);
          errorMessage = `Permission Error: Your Airtable API token doesn't have permission to create new select options. To fix this:\n\n1. Go to https://airtable.com/create/tokens\n2. Edit your token to add the "schema.bases:write" scope\n3. Or manually add the missing value to your Single Select field in Airtable\n\nDetails: ${errorMsg}`;
        } else if (errorType === "INVALID_REQUEST_UNKNOWN" || errorType === "INVALID_REQUEST_BODY") {
          errorMessage = `Invalid data format: ${errorMsg || "Please verify your data and field mappings"}`;

          const fieldMatch = errorMsg.match(/field[s]?\s+["']?([^"'\s,]+)["']?/i);
          if (fieldMatch && fieldMatch[1]) {
            fieldErrors.push({
              field: fieldMatch[1],
              error: errorMsg,
            });
          }
        } else if (errorType === "INVALID_PERMISSIONS") {
          errorMessage = `Permission denied: ${errorMsg}. Check your API token permissions.`;
        } else if (errorType === "NOT_FOUND") {
          errorMessage = `Resource not found: ${errorMsg}. Please verify your Base ID and Table ID.`;
        } else if (errorMsg) {
          errorMessage = errorMsg;
        }
      } else if (responseData.message) {
        errorMessage = responseData.message;
      }
    }

    // Handle HTTP status codes - only apply generic messages if we don't already have a specific one
    const hasSpecificError = errorMessage !== "Failed to save contact" && errorMessage !== "";
    
    if (error.message.includes("401")) {
      errorMessage = "Invalid API token. Please check your Airtable configuration.";
    } else if (error.message.includes("403")) {
      errorMessage = "Permission denied. Check your API token permissions.";
    } else if (error.message.includes("404")) {
      errorMessage = "Base or table not found. Please verify your Base ID and Table ID.";
    } else if (error.message.includes("422") && !hasSpecificError) {
      // Only use generic 422 message if we don't have a more specific error from Airtable
      errorMessage = "Invalid data format. Check your field mappings and ensure field types match.";
    } else if (error.message.includes("429")) {
      errorMessage = "Rate limit exceeded. Please wait a moment before trying again.";
    } else if (error.message.includes("network")) {
      errorMessage = "Network error. Please check your internet connection.";
    }

    return {
      message: errorMessage,
      unknownFields: unknownFields,
      fieldErrors: fieldErrors,
    };
  }

  /**
   * Fetch tag options from Airtable multi-select field
   */
  async fetchTagOptions(config, fieldMappings = {}) {
    if (!config.apiToken || !config.baseId || !config.tableId) {
      return {
        success: false,
        error: "Please provide all required configuration fields",
      };
    }

    try {
      // Get the Tags field name from mappings or use default
      const tagsFieldName = fieldMappings.tags || "Tags";

      // Fetch full schema with options
      const url = `https://api.airtable.com/v0/meta/bases/${config.baseId}/tables`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to fetch schema: HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      const table = data.tables?.find((t) => t.id === config.tableId || t.name === config.tableId);

      if (!table || !table.fields) {
        return {
          success: false,
          error: "Table not found in schema",
        };
      }

      // Find the Tags field
      const tagsField = table.fields.find((f) => f.name === tagsFieldName);

      if (!tagsField) {
        return {
          success: false,
          error: `Tags field "${tagsFieldName}" not found in Airtable. Check your field mapping.`,
          fieldNotFound: true,
        };
      }

      // Check if it's a multi-select field
      if (tagsField.type !== "multipleSelects") {
        return {
          success: false,
          error: `Tags field "${tagsFieldName}" is type "${tagsField.type}", but must be "Multi-select" in Airtable.`,
          wrongFieldType: true,
          actualType: tagsField.type,
        };
      }

      // Extract options from the field
      const options = tagsField.options?.choices || [];

      return {
        success: true,
        options: options.map((opt) => ({
          name: opt.name,
          color: opt.color || null,
        })),
        fieldName: tagsFieldName,
      };
    } catch (error) {
      console.error("Error fetching tag options:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Fetch available field names and types from Airtable
   */
  async fetchAvailableFields(config) {
    if (!config.apiToken || !config.baseId || !config.tableId) {
      return {
        success: false,
        error: "Please provide all required configuration fields",
      };
    }

    try {
      const schema = await this.fetchTableSchema(config);

      if (!schema) {
        return {
          success: false,
          error: "Could not fetch table schema. Please check your configuration.",
        };
      }

      const fields = Object.keys(schema).map((fieldName) => ({
        name: fieldName,
        type: schema[fieldName],
      }));

      return {
        success: true,
        fields: fields,
        fieldTypes: schema,
      };
    } catch (error) {
      console.error("Error fetching available fields:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate field mappings against schema
   */
  validateFieldMappings(fieldMappings, schema) {
    const errors = [];
    const warnings = [];

    Object.entries(fieldMappings).forEach(([dataKey, airtableFieldName]) => {
      if (!airtableFieldName) return;

      // Check if field exists in schema
      if (schema && !schema[airtableFieldName]) {
        errors.push({
          dataKey,
          fieldName: airtableFieldName,
          error: `Field "${airtableFieldName}" does not exist in your Airtable table`,
        });
      }
    });

    return { errors, warnings };
  }

  /**
   * Test field mappings with sample data
   */
  async testFieldMappings(sampleData, config, fieldMappings) {
    if (!config.apiToken || !config.baseId || !config.tableId) {
      return {
        success: false,
        error: "Please provide all required configuration fields",
      };
    }

    let responseData = null;

    try {
      const url = `https://api.airtable.com/v0/${config.baseId}/${config.tableId}?typecast=true`;

      // Create test fields using current mappings
      const testFields = this.mapContactDataToAirtable(sampleData, fieldMappings);

      // Add test prefix to avoid saving real data
      Object.keys(testFields).forEach((key) => {
        if (typeof testFields[key] === "string") {
          testFields[key] = "[TEST] " + testFields[key];
        }
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: testFields,
        }),
      });

      // Always try to get response data
      try {
        responseData = await response.json();
      } catch (jsonError) {
        console.warn("Failed to parse field mapping test response JSON:", jsonError);
        responseData = {};
      }

      if (!response.ok) {
        const errorInfo = this.parseAirtableError(new Error(`HTTP ${response.status}`), responseData, testFields);
        return {
          success: false,
          error: errorInfo.message,
          unknownFields: errorInfo.unknownFields,
          fieldErrors: errorInfo.fieldErrors,
          responseData: responseData,
        };
      }

      // Delete the test record to keep the table clean
      if (responseData.id) {
        try {
          await fetch(`${url}/${responseData.id}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${config.apiToken}`,
            },
          });
        } catch (deleteError) {
          console.warn("Could not delete test record:", deleteError);
        }
      }

      return {
        success: true,
        message: "Field mappings are valid",
      };
    } catch (error) {
      console.error("Field mapping test error:", error);

      const errorInfo = this.parseAirtableError(error, responseData, testFields);

      return {
        success: false,
        error: errorInfo.message,
        unknownFields: errorInfo.unknownFields,
        fieldErrors: errorInfo.fieldErrors,
      };
    }
  }
}

// Initialize background service
const backgroundService = new BackgroundService();

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
  console.log("LinkedIn to Airtable extension started");
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log("LinkedIn to Airtable extension installed/updated", details);
});
