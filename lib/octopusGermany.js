/**
 * OctopusGermany API client for ioBroker
 *
 * Adapted from Python to Node.js for use in ioBroker
 * Provides methods for interacting with the Octopus Energy API in Germany
 */

"use strict";

// Required modules
const axios = require("axios");
const jwt = require("jsonwebtoken");

// Constants
const GRAPH_QL_ENDPOINT = "https://api.oeg-kraken.energy/v1/graphql/";
const TOKEN_AUTO_REFRESH_INTERVAL = 3600 * 1000; // 1 hour in milliseconds
const TOKEN_REFRESH_MARGIN = 300; // 5 minutes before expiry

// Queries
const COMPREHENSIVE_QUERY = `
query ComprehensiveDataQuery($accountNumber: String!) {
  account(accountNumber: $accountNumber) {
    id
    ledgers {
      balance
      ledgerType
    }
    allProperties {
      id
      electricityMalos {
        agreements {
          product {
            code
            description
            fullName
          }
          unitRateGrossRateInformation {
            grossRate
          }
          unitRateInformation {
            ... on SimpleProductUnitRateInformation {
              __typename
              grossRateInformation {
                date
                grossRate
                rateValidToDate
                vatRate
              }
              latestGrossUnitRateCentsPerKwh
              netUnitRateCentsPerKwh
            }
            ... on TimeOfUseProductUnitRateInformation {
              __typename
              rates {
                grossRateInformation {
                  date
                  grossRate
                  rateValidToDate
                  vatRate
                }
                latestGrossUnitRateCentsPerKwh
                netUnitRateCentsPerKwh
                timeslotActivationRules {
                  activeFromTime
                  activeToTime
                }
                timeslotName
              }
            }
          }
          validFrom
          validTo
        }
        maloNumber
        meloNumber
        meter {
          id
          meterType
          number
          shouldReceiveSmartMeterData
          submitMeterReadingUrl
        }
        referenceConsumption
      }
    }
  }
  completedDispatches(accountNumber: $accountNumber) {
    delta
    deltaKwh
    end
    endDt
    meta {
      location
      source
    }
    start
    startDt
  }
  devices(accountNumber: $accountNumber) {
    status {
      current
      currentState
      isSuspended
    }
    provider
    preferences {
      mode
      schedules {
        dayOfWeek
        max
        min
        time
      }
      targetType
      unit
    }
    name
    integrationDeviceId
    id
    deviceType
    alerts {
      message
      publishedAt
    }
    ... on SmartFlexVehicle {
      id
      name
      status {
        current
        currentState
        isSuspended
      }
      vehicleVariant {
        model
        batterySize
      }
    }
  }
  plannedDispatches(accountNumber: $accountNumber) {
    delta
    deltaKwh
    end
    endDt
    meta {
      location
      source
    }
    start
    startDt
  }
}
`;

const ACCOUNT_DISCOVERY_QUERY = `
query {
  viewer {
    accounts {
      number
      ledgers {
        balance
        ledgerType
      }
    }
  }
}
`;

// Separate queries for optimized data fetching
const DEVICES_ONLY_QUERY = `
query DevicesOnlyQuery($accountNumber: String!) {
  devices(accountNumber: $accountNumber) {
    status {
      current
      currentState
      isSuspended
    }
    provider
    preferences {
      mode
      schedules {
        dayOfWeek
        max
        min
        time
      }
      targetType
      unit
    }
    name
    integrationDeviceId
    id
    deviceType
    alerts {
      message
      publishedAt
    }
    ... on SmartFlexVehicle {
      id
      name
      status {
        current
        currentState
        isSuspended
      }
      vehicleVariant {
        model
        batterySize
      }
    }
  }
}
`;

const DISPATCHES_ONLY_QUERY = `
query DispatchesOnlyQuery($accountNumber: String!) {
  plannedDispatches(accountNumber: $accountNumber) {
    delta
    deltaKwh
    end
    endDt
    meta {
      location
      source
    }
    start
    startDt
  }
  completedDispatches(accountNumber: $accountNumber) {
    delta
    deltaKwh
    end
    endDt
    meta {
      location
      source
    }
    start
    startDt
  }
}
`;

/**
 * Manages authentication tokens for the Octopus Germany API
 */
class TokenManager {
	constructor(adapter) {
		this._token = null;
		this._expiry = null;
		this._refreshCallback = null;
		this._refreshTimerId = null;
		this._adapter = adapter;
		this._refreshLock = false;

		// Sicherstellung, dass log existiert
		if (!this._adapter.log) {
			// Alternative Logging-Methode
			this._adapter.log = {
				silly: console.log,
				debug: console.log,
				info: console.log,
				warn: console.warn,
				error: console.error,
			};
			console.warn("OctopusGermany: adapter.log nicht vorhanden, verwende console.*");
		}
	}

	/**
	 * Get the current token
	 */
	get token() {
		return this._token;
	}

	/**
	 * Set a callback function for token refresh
	 * @param {Function} callback - Function to call when token needs to be refreshed
	 */
	setRefreshCallback(callback) {
		this._refreshCallback = callback;
	}

	/**
	 * Start automatic token refresh process
	 */
	startAutoRefresh() {
		this.stopAutoRefresh();

		// Create a new timer for token refresh
		this._refreshTimerId = setInterval(() => {
			this._adapter.log.info("Performing scheduled token refresh");

			if (this._refreshCallback) {
				// Force token refresh by temporarily invalidating the token expiry
				this._expiry = 0;
				this._refreshCallback()
					.then(() => {
						this._adapter.log.debug("Scheduled token refresh completed");
					})
					.catch((err) => {
						this._adapter.log.error(`Error in token refresh: ${err}`);
					});
			} else {
				this._adapter.log.warn("No refresh callback set, cannot auto-refresh token");
			}
		}, TOKEN_AUTO_REFRESH_INTERVAL);

		this._adapter.log.debug("Started automatic token refresh task");
	}

	/**
	 * Stop the automatic token refresh
	 */
	stopAutoRefresh() {
		if (this._refreshTimerId !== null) {
			clearInterval(this._refreshTimerId);
			this._refreshTimerId = null;
			this._adapter.log.debug("Stopped automatic token refresh task");
		}
	}

	/**
	 * Check if the current token is valid
	 */
	get isValid() {
		// Fast path: If there is no token, it's definitely invalid
		if (!this._token || !this._expiry) {
			return false;
		}

		const now = Math.floor(Date.now() / 1000);

		// Token is valid if it has at least TOKEN_REFRESH_MARGIN seconds left before expiry
		const valid = now < this._expiry - TOKEN_REFRESH_MARGIN;

		if (!valid) {
			const remainingTime = this._expiry ? this._expiry - now : 0;
			this._adapter.log.debug(`Token validity check: INVALID (expiry in ${Math.floor(remainingTime)} seconds)`);
		}

		return valid;
	}

	/**
	 * Set a new token and extract its expiry time
	 * @param {string} token - The JWT token
	 * @param {number} expiry - Optional explicit expiry timestamp
	 */
	setToken(token, expiry = null) {
		this._token = token;

		if (expiry) {
			// Use expiry directly if provided
			this._expiry = expiry;
			const now = Math.floor(Date.now() / 1000);
			const tokenLifetime = this._expiry ? this._expiry - now : 0;
			this._adapter.log.debug(`Token set with explicit expiry - valid for ${Math.floor(tokenLifetime)} seconds`);
		} else {
			// Decode token to get expiry time
			try {
				const decoded = jwt.decode(token);
				this._expiry = decoded.exp;
				const now = Math.floor(Date.now() / 1000);
				const tokenLifetime = this._expiry ? this._expiry - now : 0;
				this._adapter.log.debug(
					`Token set with decoded expiry - valid for ${Math.floor(tokenLifetime)} seconds`,
				);
			} catch (e) {
				// Fallback: If token decoding fails, set expiry to TOKEN_AUTO_REFRESH_INTERVAL from now
				const now = Math.floor(Date.now() / 1000);
				this._expiry = now + TOKEN_AUTO_REFRESH_INTERVAL / 1000;
				this._adapter.log.warn(
					`Failed to decode token expiry: ${e}. Setting fallback expiry to ${TOKEN_AUTO_REFRESH_INTERVAL / 60000} minutes`,
				);
			}
		}
	}

	/**
	 * Clear token and expiry
	 */
	clear() {
		this._token = null;
		this._expiry = null;
	}
}

/**
 * Main OctopusGermany API client class
 */
class OctopusGermany {
	/**
	 * Initialize the OctopusGermany API client
	 * @param {object} adapter - ioBroker adapter instance for logging
	 * @param {string} email - Email address for the Octopus Germany account
	 * @param {string} password - Password for the Octopus Germany account
	 * @param {object} options - Additional options (logOptions, etc.)
	 */
	constructor(adapter, email, password, options = {}) {
		this._adapter = adapter;
		this._email = email;
		this._password = password;
		this._options = {
			logApiResponses: true,
			logTokenResponses: false,
			...options,
		};

		// Sicherstellung, dass log existiert
		if (!adapter.log) {
			// Alternative Logging-Methode
			this.log = {
				silly: console.log,
				debug: console.log,
				info: console.log,
				warn: console.warn,
				error: console.error,
			};
			console.warn("OctopusGermany: adapter.log nicht vorhanden, verwende console.*");
		} else {
			this.log = adapter.log;
		}
	}

	initialize(email, password) {
		this._email = email;
		this._password = password;

		// Create instance-specific token manager
		// This allows multiple adapter instances with different accounts
		this._tokenManager = new TokenManager(this._adapter);

		// Set up the token manager refresh callback
		this._tokenManager.setRefreshCallback(() => this.login());

		// Initialize cache for static data
		this._cache = {
			account: { data: null, timestamp: 0, ttl: 3600000 }, // 1 hour TTL for account data
			devices: { data: null, timestamp: 0, ttl: 300000 }, // 5 minutes TTL for devices
			dispatches: { data: null, timestamp: 0, ttl: 60000 }, // 1 minute TTL for dispatches
		};

		this._adapter.log.info("starte TokenManager");
		// Start the auto-refresh task immediately
		this._tokenManager.startAutoRefresh();

		this._adapter.log.info("OctopusGermany wurde initialisiert");
	}

	/**
	 * Stop the token refresh process
	 */
	stopTokenRefresh() {
		if (this._tokenManager) {
			this._tokenManager.stopAutoRefresh();
		}
	}

	/**
	 * Get the current token from the token manager
	 */
	get _token() {
		return this._tokenManager.token;
	}

	/**
	 * Get headers with authorization token
	 * @returns {object} Headers object with Authorization if token exists
	 */
	_getAuthHeaders() {
		return this._token ? { Authorization: this._token } : {};
	}

	/**
	 * Execute a GraphQL query with automatic rate limiting retry
	 * @param {string} query - GraphQL query string
	 * @param {object} variables - Query variables
	 * @param {object} additionalHeaders - Additional headers
	 * @param {number} maxRetries - Maximum number of retries for rate limiting
	 * @returns {Promise<object>} Query response
	 */
	async _executeGraphQLQuery(query, variables = {}, additionalHeaders = {}, maxRetries = 3) {
		const headers = {
			...this._getAuthHeaders(),
			"Content-Type": "application/json",
			...additionalHeaders,
		};

		let attempt = 0;
		let delay = 1000; // Start with 1 second delay
		const maxDelay = 30000; // Cap at 30 seconds

		while (attempt <= maxRetries) {
			attempt++;

			try {
				const response = await axios({
					url: GRAPH_QL_ENDPOINT,
					method: "POST",
					headers,
					data: {
						query,
						variables,
					},
				});

				// Check for rate limiting in the response
				if (response.data && response.data.errors) {
					const rateLimitError = response.data.errors.find(
						(err) => err.extensions?.errorCode === "KT-CT-1199",
					);

					if (rateLimitError && attempt <= maxRetries) {
						this._adapter.log.warn(
							`Rate limit hit during API call. Retrying in ${delay / 1000}s (attempt ${attempt}/${maxRetries})`,
						);
						await new Promise((resolve) => setTimeout(resolve, delay));
						delay = Math.min(delay * 2, maxDelay); // Exponential backoff
						continue;
					}
				}

				return response.data;
			} catch (error) {
				if (error.response && error.response.data) {
					// Check for rate limiting in error response
					const errorData = error.response.data;
					if (errorData.errors) {
						const rateLimitError = errorData.errors.find(
							(err) => err.extensions?.errorCode === "KT-CT-1199",
						);

						if (rateLimitError && attempt <= maxRetries) {
							this._adapter.log.warn(
								`Rate limit hit during API call. Retrying in ${delay / 1000}s (attempt ${attempt}/${maxRetries})`,
							);
							await new Promise((resolve) => setTimeout(resolve, delay));
							delay = Math.min(delay * 2, maxDelay);
							continue;
						}
					}
					return errorData;
				} else {
					if (attempt <= maxRetries) {
						this._adapter.log.warn(
							`Network error during API call. Retrying in ${delay / 1000}s (attempt ${attempt}/${maxRetries}): ${error.message}`,
						);
						await new Promise((resolve) => setTimeout(resolve, delay));
						delay = Math.min(delay * 2, maxDelay);
						continue;
					}
					throw error;
				}
			}
		}

		throw new Error(`Max retries (${maxRetries}) exceeded for API call`);
	}

	/**
	 * Login and obtain a new token
	 * @returns {Promise<boolean>} True if login successful
	 */
	async login() {
		// Check if token is still valid
		if (this._tokenManager.isValid) {
			this._adapter.log.debug("Token still valid, skipping login");
			return true;
		}

		// Prevent concurrent login attempts
		if (this._tokenManager._refreshLock) {
			this._adapter.log.debug("Login already in progress, waiting...");
			await new Promise((resolve) => setTimeout(resolve, 2000));
			if (this._tokenManager.isValid) {
				return true;
			}
		}

		this._tokenManager._refreshLock = true;

		try {
			const query = `
                mutation krakenTokenAuthentication($email: String!, $password: String!) {
                  obtainKrakenToken(input: { email: $email, password: $password }) {
                    token
                    payload
                  }
                }
            `;
			const variables = { email: this._email, password: this._password };

			const retries = 5;
			let attempt = 0;
			let delay = 1000; // Start with 1 second delay
			const maxDelay = 30000; // Cap the delay at 30 seconds

			while (attempt < retries) {
				attempt++;
				try {
					this._adapter.log.debug(`Making login attempt ${attempt} of ${retries}`);
					const response = await this._executeGraphQLQuery(query, variables);

					// Log token response when enabled
					if (this._options.logTokenResponses) {
						const safeResponse = JSON.parse(JSON.stringify(response));
						if (safeResponse?.data?.obtainKrakenToken?.token) {
							const token = safeResponse.data.obtainKrakenToken.token;
							if (token && token.length > 10) {
								// Keep first 5 and last 5 chars, mask the rest
								const maskLength = token.length - 10;
								const maskedToken =
									token.substring(0, 5) + "*".repeat(maskLength) + token.substring(token.length - 5);
								safeResponse.data.obtainKrakenToken.token = maskedToken;
							}
						}
						this._adapter.log.info(`Token response (partial): ${JSON.stringify(safeResponse, null, 2)}`);
					}

					if (response.errors) {
						const error = response.errors[0] || {};
						const errorCode = error.extensions?.errorCode;
						const errorMessage = error.message || "Unknown error";

						if (errorCode === "KT-CT-1199") {
							// Too many requests
							this._adapter.log.warn(
								`Rate limit hit. Retrying in ${delay / 1000} seconds... (attempt ${attempt} of ${retries})`,
							);
							await new Promise((resolve) => setTimeout(resolve, delay));
							delay = Math.min(delay * 2, maxDelay); // Exponential backoff with max cap
							continue;
						} else {
							this._adapter.log.error(`Login failed: ${errorMessage} (attempt ${attempt} of ${retries})`);
							// For other types of errors, continue with retries
							await new Promise((resolve) => setTimeout(resolve, delay));
							delay = Math.min(delay * 2, maxDelay);
							continue;
						}
					}

					if (response.data && response.data.obtainKrakenToken) {
						const tokenData = response.data.obtainKrakenToken;
						const token = tokenData.token;
						const payload = tokenData.payload;

						if (token) {
							// Pass both token and expiration time to the token manager
							if (payload && typeof payload === "object" && payload.exp) {
								this._tokenManager.setToken(token, payload.exp);
							} else {
								// Fall back to JWT decoding if no payload available
								this._tokenManager.setToken(token);
							}

							return true;
						} else {
							this._adapter.log.error(
								`No token in response despite successful request (attempt ${attempt} of ${retries})`,
							);
						}
					} else {
						this._adapter.log.error(
							`Unexpected API response format at attempt ${attempt}: ${JSON.stringify(response)}`,
						);
					}

					// If we got here with an invalid response, try again
					await new Promise((resolve) => setTimeout(resolve, delay));
					delay = Math.min(delay * 2, maxDelay);
				} catch (e) {
					this._adapter.log.error(`Error during login attempt ${attempt}: ${e}`);
					await new Promise((resolve) => setTimeout(resolve, delay));
					delay = Math.min(delay * 2, maxDelay);
				}
			}

			this._adapter.log.error(`All ${retries} login attempts failed.`);
			return false;
		} finally {
			this._tokenManager._refreshLock = false;
		}
	}

	/**
	 * Ensure a valid token is available, refreshing if necessary
	 * @returns {Promise<boolean>} True if token is valid
	 */
	async ensureToken() {
		if (!this._tokenManager.isValid) {
			this._adapter.log.debug("Token invalid or expired, logging in again");
			return await this.login();
		}
		return true;
	}

	/**
	 * Fetch accounts and initial data in a single API call
	 * @returns {Promise<Array|null>} Array of accounts or null on error
	 */
	async fetchAccountsWithInitialData() {
		await this.ensureToken();

		try {
			const response = await this._executeGraphQLQuery(ACCOUNT_DISCOVERY_QUERY);
			this._adapter.log.debug(`Fetch accounts with initial data response: ${JSON.stringify(response)}`);

			if (response.data && response.data.viewer) {
				const accounts = response.data.viewer.accounts;
				if (!accounts || accounts.length === 0) {
					this._adapter.log.error("No accounts found");
					return null;
				}

				// Return the accounts data
				return accounts;
			} else {
				this._adapter.log.error(`Unexpected API response structure: ${JSON.stringify(response)}`);
				return null;
			}
		} catch (e) {
			this._adapter.log.error(`Error fetching accounts with initial data: ${e}`);
			return null;
		}
	}

	/**
	 * Fetch account numbers
	 * @returns {Promise<Array>} Array of account numbers
	 */
	async accounts() {
		const accounts = await this.fetchAccountsWithInitialData();
		if (!accounts) {
			this._adapter.log.error("Failed to fetch accounts");
			throw new Error("Failed to fetch accounts");
		}

		return accounts.map((account) => account.number);
	}

	/**
	 * Fetch accounts data
	 * @returns {Promise<Array|null>} Array of account data or null on error
	 */
	async fetchAccounts() {
		return await this.fetchAccountsWithInitialData();
	}

	/**
	 * Fetch all data for an account including devices, dispatches and account details
	 * @param {string} accountNumber - Account number to fetch data for
	 * @returns {Promise<object|null>} Account data or null on error
	 */
	async fetchAllData(accountNumber) {
		if (!(await this.ensureToken())) {
			this._adapter.log.error("Failed to ensure valid token for fetch_all_data");
			return null;
		}

		const variables = { accountNumber };

		try {
			this._adapter.log.debug(`Making API request to fetchAllData for account ${accountNumber}`);
			const response = await this._executeGraphQLQuery(COMPREHENSIVE_QUERY, variables);

			// Log the full API response when enabled
			if (this._options.logApiResponses) {
				this._adapter.log.info(`API Response: ${JSON.stringify(response, null, 2)}`);
			} else {
				this._adapter.log.debug("API request completed. Set logApiResponses=true for full response logging");
			}

			if (response === null) {
				this._adapter.log.error("API returned null response");
				return null;
			}

			// Initialize the result structure
			const result = {
				account: {},
				products: [],
				completedDispatches: [],
				devices: [],
				plannedDispatches: [],
			};

			// Now check for partial data availability
			if (response.data) {
				this._adapter.log.debug(`Response data structure: ${JSON.stringify(Object.keys(response.data))}`);
				const data = response.data;

				// Process available data fields
				if (data.account) {
					result.account = data.account;

					// Extract product information from the account agreements if available
					if (result.account && result.account.allProperties && result.account.allProperties.length > 0) {
						try {
							// Try to extract products from electricityMalos agreements
							const products = [];
							for (const propertyData of result.account.allProperties) {
								if (propertyData.electricityMalos) {
									for (const malo of propertyData.electricityMalos) {
										if (malo.agreements) {
											for (const agreement of malo.agreements) {
												if (agreement.product) {
													products.push(agreement.product);
												}
											}
										}
									}
								}
							}

							// Only update if we found products
							if (products.length > 0) {
								result.products = products;
								this._adapter.log.debug(`Extracted ${products.length} products from account data`);
							}
						} catch (extractError) {
							this._adapter.log.warn(`Error extracting products from account data: ${extractError}`);
						}
					}
				}

				if (data.devices) {
					result.devices = data.devices !== null ? data.devices : [];
				}

				if (data.completedDispatches) {
					result.completedDispatches = data.completedDispatches !== null ? data.completedDispatches : [];
				}

				if (data.plannedDispatches) {
					result.plannedDispatches = data.plannedDispatches !== null ? data.plannedDispatches : [];
				}

				// Only log errors but don't fail the whole request if we got at least account data
				if (response.errors && result.account) {
					// Filter only the errors that are about missing devices or dispatches
					const nonCriticalErrors = (response.errors || []).filter((error) => {
						const path = error.path || [];
						return (
							path[0] &&
							["completedDispatches", "plannedDispatches", "devices"].includes(path[0]) &&
							error.extensions?.errorCode === "KT-CT-4301"
						);
					});

					// Handle other errors that might affect the account data
					const otherErrors = (response.errors || []).filter((error) => !nonCriticalErrors.includes(error));

					if (nonCriticalErrors.length > 0) {
						this._adapter.log.warn(
							`API returned non-critical errors (expected for accounts without devices/dispatches): ${JSON.stringify(nonCriticalErrors)}`,
						);
					}

					if (otherErrors.length > 0) {
						this._adapter.log.error(`API returned critical errors: ${JSON.stringify(otherErrors)}`);

						// Check for token expiry in the other errors
						for (const error of otherErrors) {
							const errorCode = error.extensions?.errorCode;
							if (errorCode === "KT-CT-1124") {
								// JWT expired
								this._adapter.log.warn("Token expired, refreshing...");
								this._tokenManager.clear();
								const success = await this.login();
								if (success) {
									// Retry with new token
									return await this.fetchAllData(accountNumber);
								}
							}
						}
					}
				}

				return result;
			} else if (response.errors) {
				// Handle critical errors that prevent any data from being returned
				const error = response.errors[0] || {};
				const errorCode = error.extensions?.errorCode;

				// Check if token expired error
				if (errorCode === "KT-CT-1124") {
					// JWT expired
					this._adapter.log.warn("Token expired, refreshing...");
					this._tokenManager.clear();
					const success = await this.login();
					if (success) {
						// Retry with new token
						return await this.fetchAllData(accountNumber);
					}
				}

				this._adapter.log.error(
					`API returned critical errors with no data: ${JSON.stringify(response.errors)}`,
				);
				return null;
			} else {
				this._adapter.log.error("API response contains neither data nor errors");
				return null;
			}
		} catch (e) {
			this._adapter.log.error(`Error fetching all data: ${e}`);
			return null;
		}
	}

	/**
	 * Check if cached data is still valid
	 * @param {string} cacheKey - Key for cache entry
	 * @returns {boolean} True if cache is valid
	 * @private
	 */
	_isCacheValid(cacheKey) {
		const cache = this._cache[cacheKey];
		if (!cache || !cache.data) {
			return false;
		}
		const age = Date.now() - cache.timestamp;
		return age < cache.ttl;
	}

	/**
	 * Get data from cache
	 * @param {string} cacheKey - Key for cache entry
	 * @returns {any|null} Cached data or null
	 * @private
	 */
	_getFromCache(cacheKey) {
		if (this._isCacheValid(cacheKey)) {
			this._adapter.log.debug(`Using cached data for ${cacheKey}`);
			return this._cache[cacheKey].data;
		}
		return null;
	}

	/**
	 * Store data in cache
	 * @param {string} cacheKey - Key for cache entry
	 * @param {any} data - Data to cache
	 * @private
	 */
	_setCache(cacheKey, data) {
		this._cache[cacheKey] = {
			data: data,
			timestamp: Date.now(),
			ttl: this._cache[cacheKey].ttl,
		};
		this._adapter.log.debug(`Cached data for ${cacheKey}`);
	}

	/**
	 * Fetch only devices data
	 * @param {string} accountNumber - Account number
	 * @param {boolean} useCache - Whether to use cached data (default: true)
	 * @returns {Promise<Array|null>} Devices array or null on error
	 */
	async fetchDevices(accountNumber, useCache = true) {
		if (useCache) {
			const cached = this._getFromCache("devices");
			if (cached) {
				return cached;
			}
		}

		if (!(await this.ensureToken())) {
			this._adapter.log.error("Failed to ensure valid token for fetchDevices");
			return null;
		}

		try {
			const response = await this._executeGraphQLQuery(DEVICES_ONLY_QUERY, { accountNumber });

			if (response && response.data && response.data.devices) {
				const devices = response.data.devices || [];
				this._setCache("devices", devices);
				return devices;
			}

			this._adapter.log.error("Failed to fetch devices");
			return null;
		} catch (e) {
			this._adapter.log.error(`Error fetching devices: ${e}`);
			return null;
		}
	}

	/**
	 * Fetch only dispatches data (planned and completed)
	 * @param {string} accountNumber - Account number
	 * @param {boolean} useCache - Whether to use cached data (default: true)
	 * @returns {Promise<Object|null>} Object with plannedDispatches and completedDispatches or null
	 */
	async fetchDispatches(accountNumber, useCache = true) {
		if (useCache) {
			const cached = this._getFromCache("dispatches");
			if (cached) {
				return cached;
			}
		}

		if (!(await this.ensureToken())) {
			this._adapter.log.error("Failed to ensure valid token for fetchDispatches");
			return null;
		}

		try {
			const response = await this._executeGraphQLQuery(DISPATCHES_ONLY_QUERY, { accountNumber });

			if (response && response.data) {
				const dispatches = {
					plannedDispatches: response.data.plannedDispatches || [],
					completedDispatches: response.data.completedDispatches || [],
				};
				this._setCache("dispatches", dispatches);
				return dispatches;
			}

			this._adapter.log.error("Failed to fetch dispatches");
			return null;
		} catch (e) {
			this._adapter.log.error(`Error fetching dispatches: ${e}`);
			return null;
		}
	}

	/**
	 * Invalidate cache for a specific key or all caches
	 * @param {string} cacheKey - Key to invalidate, or null for all
	 */
	invalidateCache(cacheKey = null) {
		if (cacheKey) {
			if (this._cache[cacheKey]) {
				this._cache[cacheKey].timestamp = 0;
				this._adapter.log.debug(`Invalidated cache for ${cacheKey}`);
			}
		} else {
			// Invalidate all caches
			Object.keys(this._cache).forEach((key) => {
				this._cache[key].timestamp = 0;
			});
			this._adapter.log.debug("Invalidated all caches");
		}
	}

	/**
	 * Change device suspension state
	 * @param {string} deviceId - Device ID
	 * @param {string} action - Action to perform (SUSPEND, RESUME)
	 * @returns {Promise<string|null>} Device ID if successful, null on error
	 */
	async changeDeviceSuspension(deviceId, action) {
		if (!(await this.ensureToken())) {
			this._adapter.log.error("Failed to ensure valid token for change_device_suspension");
			return null;
		}

		const query = `
            mutation ChangeDeviceSuspension($deviceId: ID = "", $action: SmartControlAction!) {
              updateDeviceSmartControl(input: {deviceId: $deviceId, action: $action}) {
                id
              }
            }
        `;
		const variables = { deviceId, action };
		this._adapter.log.debug(`Executing changeDeviceSuspension: deviceId=${deviceId}, action=${action}`);

		try {
			const response = await this._executeGraphQLQuery(query, variables);
			this._adapter.log.debug(`Change device suspension response: ${JSON.stringify(response)}`);

			if (response.errors) {
				const error = response.errors[0] || {};
				const errorCode = error.extensions?.errorCode;

				// Check if token expired error
				if (errorCode === "KT-CT-1124") {
					// JWT expired
					this._adapter.log.warn("Token expired during device suspension change, refreshing...");
					this._tokenManager.clear();
					const success = await this.login();
					if (success) {
						// Retry with new token
						return await this.changeDeviceSuspension(deviceId, action);
					}
				}

				this._adapter.log.error(`API returned errors: ${JSON.stringify(response.errors)}`);
				return null;
			}

			// Invalidate device cache after successful suspension change
			this.invalidateCache("devices");

			return response?.data?.updateDeviceSmartControl?.id || null;
		} catch (e) {
			this._adapter.log.error(`Error changing device suspension: ${e}`);
			return null;
		}
	}

	/**
	 * Set vehicle charging preferences
	 * @param {string} accountNumber - Account number
	 * @param {number} weekdayTargetSoc - Weekday target state of charge percentage
	 * @param {number} weekendTargetSoc - Weekend target state of charge percentage
	 * @param {string} weekdayTargetTime - Weekday target time (HH:MM format)
	 * @param {string} weekendTargetTime - Weekend target time (HH:MM format)
	 * @returns {Promise<boolean>} True if successful
	 */
	async setVehicleChargePreferences(
		accountNumber,
		weekdayTargetSoc,
		weekendTargetSoc,
		weekdayTargetTime,
		weekendTargetTime,
	) {
		if (!(await this.ensureToken())) {
			this._adapter.log.error("Failed to ensure valid token for setVehicleChargePreferences");
			return false;
		}

		// Format and validate the input times
		try {
			// Format weekday time - ensure it's in HH:MM format
			const weekdayTime = this.formatTimeToHhMm(weekdayTargetTime);

			// Format weekend time - ensure it's in HH:MM format
			const weekendTime = this.formatTimeToHhMm(weekendTargetTime);

			this._adapter.log.debug(`Formatted times for API: weekday=${weekdayTime}, weekend=${weekendTime}`);

			// Use the same GraphQL mutation format that has been confirmed to work
			const query = `
            mutation setVehicleChargePreferences($accountNumber: String = "") {
              setVehicleChargePreferences(
                input: {accountNumber: $accountNumber, weekdayTargetSoc: ${weekdayTargetSoc}, weekendTargetSoc: ${weekendTargetSoc}, weekdayTargetTime: "${weekdayTime}", weekendTargetTime: "${weekendTime}"}
              ) {
                krakenflexDevice {
                  provider
                }
              }
            }
            `;

			const variables = { accountNumber };

			this._adapter.log.debug(`Making setVehicleChargePreferences API request with account: ${accountNumber}`);

			try {
				const response = await this._executeGraphQLQuery(query, variables);
				this._adapter.log.debug(`Set vehicle charge preferences response: ${JSON.stringify(response)}`);

				if (response.errors) {
					const error = response.errors[0] || {};
					const errorCode = error.extensions?.errorCode;
					const errorMessage = error.message || "Unknown error";

					this._adapter.log.error(
						`API error setting vehicle charge preferences: ${errorMessage} (code: ${errorCode})`,
					);

					// Check if token expired error
					if (errorCode === "KT-CT-1124") {
						// JWT expired
						this._adapter.log.warn(
							"Token expired during setting vehicle charge preferences, refreshing...",
						);
						this._tokenManager.clear();
						const success = await this.login();
						if (success) {
							// Retry with new token
							return await this.setVehicleChargePreferences(
								accountNumber,
								weekdayTargetSoc,
								weekendTargetSoc,
								weekdayTargetTime,
								weekendTargetTime,
							);
						}
					}

					return false;
				}

				return true;
			} catch (e) {
				this._adapter.log.error(`Error setting vehicle charge preferences: ${e}`);
				return false;
			}
		} catch (e) {
			this._adapter.log.error(`Time format validation error: ${e}`);
			return false;
		}
	}

	// Time Formatting Functions for ioBroker
	// This script can be added to ioBroker under Javascript/Scripts

	/**
	 * Formats a time string to HH:MM format required by the API.
	 * Handles various input formats like "HH:MM:SS", "HH:MM",
	 * or time selector values from ioBroker/Home Assistant.
	 *
	 * @param {string} timeStr - Time string in various formats
	 * @returns {string} - Time formatted as "HH:MM"
	 * @throws {Error} - If timeStr cannot be parsed or contains invalid hours/minutes
	 */
	formatTimeToHhMm(timeStr) {
		if (!timeStr) {
			throw new Error("Empty time value provided");
		}

		// First try to split by colon
		const parts = timeStr.split(":");
		if (parts.length >= 2) {
			// Extract hours and minutes
			try {
				const hours = parseInt(parts[0], 10);
				const minutes = parseInt(parts[1], 10);

				// Validate hours and minutes
				if (!(hours >= 0 && hours <= 23)) {
					throw new Error(`Invalid hour value: ${hours}. Hours must be between 0 and 23`);
				}
				if (!(minutes >= 0 && minutes <= 59)) {
					throw new Error(`Invalid minute value: ${minutes}. Minutes must be between 0 and 59`);
				}

				// Format with leading zeros
				return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
			} catch (e) {
				throw new Error(`Invalid time format: '${timeStr}' - Hours and minutes must be numbers`);
			}
		} else {
			// For other formats, try using Date object
			const formats = [
				{
					regex: /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/,
					fn: (m) => ({ h: parseInt(m[1], 10), m: parseInt(m[2], 10) }),
				}, // HH:MM:SS
				{ regex: /^(\d{1,2}):(\d{1,2})$/, fn: (m) => ({ h: parseInt(m[1], 10), m: parseInt(m[2], 10) }) }, // HH:MM
				{
					regex: /^(\d{1,2}):(\d{1,2}) (AM|PM)$/i,
					fn: (m) => ({
						h:
							m[3].toUpperCase() === "PM" && parseInt(m[1], 10) < 12
								? parseInt(m[1], 10) + 12
								: m[3].toUpperCase() === "AM" && parseInt(m[1], 10) === 12
									? 0
									: parseInt(m[1], 10),
						m: parseInt(m[2], 10),
					}),
				}, // HH:MM AM/PM
				{
					regex: /^(\d{1,2}):(\d{1,2}):(\d{1,2}) (AM|PM)$/i,
					fn: (m) => ({
						h:
							m[4].toUpperCase() === "PM" && parseInt(m[1], 10) < 12
								? parseInt(m[1], 10) + 12
								: m[4].toUpperCase() === "AM" && parseInt(m[1], 10) === 12
									? 0
									: parseInt(m[1], 10),
						m: parseInt(m[2], 10),
					}),
				}, // HH:MM:SS AM/PM
			];

			for (const format of formats) {
				const match = timeStr.match(format.regex);
				if (match) {
					const time = format.fn(match);

					// Validate
					if (!(time.h >= 0 && time.h <= 23)) {
						throw new Error(`Invalid hour value: ${time.h}. Hours must be between 0 and 23`);
					}
					if (!(time.m >= 0 && time.m <= 59)) {
						throw new Error(`Invalid minute value: ${time.m}. Minutes must be between 0 and 59`);
					}

					return `${time.h.toString().padStart(2, "0")}:${time.m.toString().padStart(2, "0")}`;
				}
			}

			// If we get here, none of the formats worked
			throw new Error(`Could not parse time: '${timeStr}'. Please use HH:MM format (e.g. '05:00')`);
		}
	}

	/**
	 * Helper function for logging in ioBroker
	 * @param {string} message - Message to log
	 * @param {string} [level='info'] - Log level (info, warn, error)
	 */
	log(message, level = "info") {
		if (typeof console !== "undefined") {
			if (level === "error") {
				console.error(message);
			} else if (level === "warn") {
				console.warn(message);
			} else {
				console.log(message);
			}
		}
	}

	/**
	 * Fetch account and devices data using the comprehensive query.
	 * This method is kept for backward compatibility but now uses the same
	 * comprehensive query as fetchAllData.
	 *
	 * @deprecated Use fetchAllData() instead
	 * @param {string} accountNumber - Account number for the query
	 * @returns {Promise<Object>} - Object with account and device data
	 */
	async fetchAccountAndDevices(accountNumber) {
		this._adapter.log.warn("Using fetchAccountAndDevices (deprecated - using comprehensive query)");

		try {
			const allData = await this.fetchAllData(accountNumber);
			if (!allData) {
				return {
					account: {},
					devices: [],
				};
			}

			// Return just the parts needed by the legacy method
			return {
				account: allData.account,
				devices: allData.devices,
			};
		} catch (error) {
			this._adapter.log.error(`Error fetching account and device data: ${error.message}`);
			throw error;
		}
	}
}
module.exports = OctopusGermany;
