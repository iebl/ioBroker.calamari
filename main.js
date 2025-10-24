"use strict";

/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const OctopusGermany = require("./lib/octopusGermany");
const { AIDecisionEngine } = require("./lib/aiMode");

// Load your modules here, e.g.:
// const fs = require("fs");

class Calamari extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "calamari",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));

		// Instanz der OctopusGermany-Klasse erstellen

		this.octopusGermany = new OctopusGermany(this);

		// Store for planned dispatches
		this.plannedDispatches = [];

		// AI Decision Engine (initialized in onReady if enabled)
		this.aiEngine = null;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here
		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		//this.log.info("Octopus Server: " + this.config.server);
		//this.log.info("Octopus E-Mail: " + this.config.email);
		//this.log.info("Octopus Password: " + this.config.password);

		// OctopusGermany initialize
		this.setState("info.connection", false, true);
		this.octopusGermany.initialize(this.config.email, this.config.password);

		// Login is async, must await it
		const loginSuccess = await this.octopusGermany.login();
		if (loginSuccess) {
			// Auto-discover account if not configured
			if (!this.config.account || this.config.account.trim() === "") {
				this.log.info("No account number configured, attempting auto-discovery...");
				try {
					const accounts = await this.octopusGermany.accounts();
					if (accounts && accounts.length > 0) {
						this.config.account = accounts[0];
						this.log.info(`Auto-discovered account: ${this.config.account}`);
						// Save the discovered account to config
						this.extendForeignObject(`system.adapter.${this.namespace}`, {
							native: { account: this.config.account },
						});
					} else {
						this.log.error("No accounts found for this user");
						this.terminate("No Account Found");
						return;
					}
				} catch (error) {
					this.log.error(`Failed to auto-discover account: ${error.message}`);
					this.terminate("Account Discovery Failed");
					return;
				}
			}

			// Set charging preferences if enabled
			if (this.config.enableChargingPreferences) {
				this.log.info("Setting vehicle charging preferences...");
				try {
					const success = await this.octopusGermany.setVehicleChargePreferences(
						this.config.account,
						this.config.weekdayTargetSoc,
						this.config.weekendTargetSoc,
						this.config.weekdayTargetTime,
						this.config.weekendTargetTime,
					);

					if (success) {
						this.log.info("Vehicle charging preferences set successfully");
					} else {
						this.log.warn("Failed to set vehicle charging preferences");
					}
				} catch (error) {
					this.log.error(`Error setting charging preferences: ${error.message}`);
				}
			}

			await this.fetchDataFromAPI();

			// Create cheap phase states
			await this.createCheapPhaseStates();

			// Start cheap phase checker (every 60 seconds)
			this.phaseCheckInterval = setInterval(() => {
				this.checkCheapPhase();
			}, 60000);

			// Initial check
			await this.checkCheapPhase();

			// Initialize AI Mode if enabled
			if (this.config.enableAiMode) {
				this.log.info("AI Mode is enabled, initializing AI Decision Engine...");
				try {
					this.aiEngine = new AIDecisionEngine(this, this.config);
					await this.aiEngine.initialize();
					this.log.info("AI Decision Engine initialized successfully");
				} catch (error) {
					this.log.error(`Failed to initialize AI Decision Engine: ${error.message}`);
					this.log.warn("Continuing without AI Mode");
				}
			} else {
				this.log.debug("AI Mode is disabled");
			}

			// Starte die zyklische Abfrage
			this.pollInterval = setInterval(() => {
				this.fetchDataFromAPI();
			}, this.config.pollInterval * 1000);
		} else {
			this.setState("info.connection", false, true);
			this.log.error("Login not possible - check credentials");
			this.terminate("No Login");
		}
	}

	async fetchDataFromAPI() {
		try {
			const allData = await this.octopusGermany.fetchAllData(this.config.account);

			if (!allData) {
				this.log.error("Failed to fetch data from API - no data returned");
				this.setState("info.connection", false, true);
				return;
			}

			this.log.debug(`Fetched data from API: ${JSON.stringify(allData)}`);

			// Create data points for each section
			if (allData.account) {
				this.createDataPointsFromJson.call(this, allData.account, this.name + "." + this.instance + ".account");
				// Process pricing information
				await this.processPricingData(allData.account);
			}
			if (allData.devices) {
				this.createDataPointsFromJson.call(this, allData.devices, this.name + "." + this.instance + ".devices");
			}
			if (allData.plannedDispatches) {
				this.createDataPointsFromJson.call(
					this,
					allData.plannedDispatches,
					this.name + "." + this.instance + ".plannedDispatches",
				);
				// Store planned dispatches for cheap phase checking
				this.plannedDispatches = Array.isArray(allData.plannedDispatches)
					? allData.plannedDispatches
					: [];
				// Trigger immediate cheap phase check after updating dispatches
				await this.checkCheapPhase();
			}
			if (allData.completedDispatches) {
				this.createDataPointsFromJson.call(
					this,
					allData.completedDispatches,
					this.name + "." + this.instance + ".completedDispatches",
				);
			}

			// Process device alerts
			if (allData.devices) {
				await this.processDeviceAlerts(allData.devices);
			}

			// Subscribe to device states (only done once per device in subscribeDeviceStates)
			this.subscribeDeviceStates(allData.devices);
			this.setState("info.connection", true, true);
		} catch (error) {
			this.log.error(`Error fetching data from API: ${error.message}`);
			this.setState("info.connection", false, true);
		}
	}

	/**
	 * Create states for cheap phase detection
	 */
	async createCheapPhaseStates() {
		const basePath = `${this.name}.${this.instance}.cheapPhase`;

		// Create channel
		await this.setObjectNotExistsAsync(basePath, {
			type: "channel",
			common: {
				name: "Cheap Electricity Phase Information",
			},
			native: {},
		});

		// Main state: Are we currently in a cheap phase?
		await this.setObjectNotExistsAsync(`${basePath}.active`, {
			type: "state",
			common: {
				name: "In Cheap Phase",
				type: "boolean",
				role: "indicator",
				read: true,
				write: false,
				def: false,
			},
			native: {},
		});

		// Current phase details
		await this.setObjectNotExistsAsync(`${basePath}.current`, {
			type: "channel",
			common: {
				name: "Current Phase Details",
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.current.start`, {
			type: "state",
			common: {
				name: "Current Phase Start Time",
				type: "string",
				role: "value.datetime",
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.current.end`, {
			type: "state",
			common: {
				name: "Current Phase End Time",
				type: "string",
				role: "value.datetime",
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.current.deltaKwh`, {
			type: "state",
			common: {
				name: "Current Phase Energy (kWh)",
				type: "number",
				role: "value.power.consumption",
				read: true,
				write: false,
				unit: "kWh",
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.current.remainingMinutes`, {
			type: "state",
			common: {
				name: "Minutes Remaining in Current Phase",
				type: "number",
				role: "value",
				read: true,
				write: false,
				unit: "min",
			},
			native: {},
		});

		// Next phase details
		await this.setObjectNotExistsAsync(`${basePath}.next`, {
			type: "channel",
			common: {
				name: "Next Phase Details",
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.next.start`, {
			type: "state",
			common: {
				name: "Next Phase Start Time",
				type: "string",
				role: "value.datetime",
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.next.end`, {
			type: "state",
			common: {
				name: "Next Phase End Time",
				type: "string",
				role: "value.datetime",
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.next.deltaKwh`, {
			type: "state",
			common: {
				name: "Next Phase Energy (kWh)",
				type: "number",
				role: "value.power.consumption",
				read: true,
				write: false,
				unit: "kWh",
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.next.minutesUntilStart`, {
			type: "state",
			common: {
				name: "Minutes Until Next Phase",
				type: "number",
				role: "value",
				read: true,
				write: false,
				unit: "min",
			},
			native: {},
		});

		this.log.debug("Cheap phase states created");
	}

	/**
	 * Check if we are currently in a cheap electricity phase
	 * and update related states
	 */
	async checkCheapPhase() {
		try {
			const now = new Date();
			const basePath = `${this.name}.${this.instance}.cheapPhase`;

			if (!this.plannedDispatches || this.plannedDispatches.length === 0) {
				// No planned dispatches available
				await this.setStateAsync(`${basePath}.active`, { val: false, ack: true });
				await this.setStateAsync(`${basePath}.current.start`, { val: "", ack: true });
				await this.setStateAsync(`${basePath}.current.end`, { val: "", ack: true });
				await this.setStateAsync(`${basePath}.current.deltaKwh`, { val: 0, ack: true });
				await this.setStateAsync(`${basePath}.current.remainingMinutes`, { val: 0, ack: true });
				await this.setStateAsync(`${basePath}.next.start`, { val: "", ack: true });
				await this.setStateAsync(`${basePath}.next.end`, { val: "", ack: true });
				await this.setStateAsync(`${basePath}.next.deltaKwh`, { val: 0, ack: true });
				await this.setStateAsync(`${basePath}.next.minutesUntilStart`, { val: 0, ack: true });
				return;
			}

			// Find current and next phases
			let currentPhase = null;
			let nextPhase = null;

			for (const dispatch of this.plannedDispatches) {
				if (!dispatch.startDt || !dispatch.endDt) {
					continue;
				}

				const start = new Date(dispatch.startDt);
				const end = new Date(dispatch.endDt);

				// Check if we're in this phase
				if (now >= start && now <= end) {
					currentPhase = dispatch;
					break;
				}

				// Find next upcoming phase
				if (now < start) {
					if (!nextPhase || new Date(dispatch.startDt) < new Date(nextPhase.startDt)) {
						nextPhase = dispatch;
					}
				}
			}

			// Update current phase states
			if (currentPhase) {
				const start = new Date(currentPhase.startDt);
				const end = new Date(currentPhase.endDt);
				const remainingMs = end - now;
				const remainingMinutes = Math.ceil(remainingMs / 60000);
				const deltaKwh = parseFloat(currentPhase.deltaKwh || currentPhase.delta || 0);

				await this.setStateAsync(`${basePath}.active`, { val: true, ack: true });
				await this.setStateAsync(`${basePath}.current.start`, { val: currentPhase.startDt, ack: true });
				await this.setStateAsync(`${basePath}.current.end`, { val: currentPhase.endDt, ack: true });
				await this.setStateAsync(`${basePath}.current.deltaKwh`, { val: deltaKwh, ack: true });
				await this.setStateAsync(`${basePath}.current.remainingMinutes`, { val: remainingMinutes, ack: true });

				this.log.info(
					`Currently in cheap phase: ${currentPhase.startDt} - ${currentPhase.endDt} (${remainingMinutes} min remaining)`,
				);
			} else {
				// Not in a cheap phase
				await this.setStateAsync(`${basePath}.active`, { val: false, ack: true });
				await this.setStateAsync(`${basePath}.current.start`, { val: "", ack: true });
				await this.setStateAsync(`${basePath}.current.end`, { val: "", ack: true });
				await this.setStateAsync(`${basePath}.current.deltaKwh`, { val: 0, ack: true });
				await this.setStateAsync(`${basePath}.current.remainingMinutes`, { val: 0, ack: true });
			}

			// Update next phase states
			if (nextPhase) {
				const start = new Date(nextPhase.startDt);
				const untilStartMs = start - now;
				const minutesUntilStart = Math.ceil(untilStartMs / 60000);
				const deltaKwh = parseFloat(nextPhase.deltaKwh || nextPhase.delta || 0);

				await this.setStateAsync(`${basePath}.next.start`, { val: nextPhase.startDt, ack: true });
				await this.setStateAsync(`${basePath}.next.end`, { val: nextPhase.endDt, ack: true });
				await this.setStateAsync(`${basePath}.next.deltaKwh`, { val: deltaKwh, ack: true });
				await this.setStateAsync(`${basePath}.next.minutesUntilStart`, { val: minutesUntilStart, ack: true });

				this.log.debug(
					`Next cheap phase: ${nextPhase.startDt} - ${nextPhase.endDt} (starts in ${minutesUntilStart} min)`,
				);
			} else {
				// No upcoming phase
				await this.setStateAsync(`${basePath}.next.start`, { val: "", ack: true });
				await this.setStateAsync(`${basePath}.next.end`, { val: "", ack: true });
				await this.setStateAsync(`${basePath}.next.deltaKwh`, { val: 0, ack: true });
				await this.setStateAsync(`${basePath}.next.minutesUntilStart`, { val: 0, ack: true });
			}
		} catch (error) {
			this.log.error(`Error checking cheap phase: ${error.message}`);
		}
	}

	/**
	 * Process pricing information from account data and create pricing states
	 * @param {Object} accountData - Account data with pricing information
	 */
	async processPricingData(accountData) {
		if (!accountData || !accountData.allProperties) {
			return;
		}

		try {
			const basePath = `${this.name}.${this.instance}.pricing`;

			// Create pricing channel
			await this.setObjectNotExistsAsync(basePath, {
				type: "channel",
				common: {
					name: "Electricity Pricing",
				},
				native: {},
			});

			accountData.allProperties.forEach((property, propIndex) => {
				if (property.electricityMalos) {
					property.electricityMalos.forEach((malo, maloIndex) => {
						if (malo.agreements) {
							malo.agreements.forEach(async (agreement, agreeIndex) => {
								if (agreement.unitRateInformation) {
									const rateInfo = agreement.unitRateInformation;
									const ratePath = `${basePath}.malo_${maloIndex}_agreement_${agreeIndex}`;

									// Handle SimpleProductUnitRateInformation
									if (rateInfo.__typename === "SimpleProductUnitRateInformation") {
										if (rateInfo.latestGrossUnitRateCentsPerKwh !== undefined) {
											await this.setObjectNotExistsAsync(`${ratePath}.grossRate`, {
												type: "state",
												common: {
													name: "Current Gross Rate (cents/kWh)",
													type: "number",
													role: "value.price",
													read: true,
													write: false,
													unit: "ct/kWh",
												},
												native: {},
											});
											await this.setStateAsync(`${ratePath}.grossRate`, {
												val: rateInfo.latestGrossUnitRateCentsPerKwh,
												ack: true,
											});
										}

										if (rateInfo.netUnitRateCentsPerKwh !== undefined) {
											await this.setObjectNotExistsAsync(`${ratePath}.netRate`, {
												type: "state",
												common: {
													name: "Current Net Rate (cents/kWh)",
													type: "number",
													role: "value.price",
													read: true,
													write: false,
													unit: "ct/kWh",
												},
												native: {},
											});
											await this.setStateAsync(`${ratePath}.netRate`, {
												val: rateInfo.netUnitRateCentsPerKwh,
												ack: true,
											});
										}
									}

									// Handle TimeOfUseProductUnitRateInformation
									if (rateInfo.__typename === "TimeOfUseProductUnitRateInformation" && rateInfo.rates) {
										rateInfo.rates.forEach(async (rate, rateIndex) => {
											const timeSlotPath = `${ratePath}.timeslot_${rateIndex}`;

											// Create timeslot name state
											if (rate.timeslotName) {
												await this.setObjectNotExistsAsync(`${timeSlotPath}.name`, {
													type: "state",
													common: {
														name: "Timeslot Name",
														type: "string",
														role: "text",
														read: true,
														write: false,
													},
													native: {},
												});
												await this.setStateAsync(`${timeSlotPath}.name`, {
													val: rate.timeslotName,
													ack: true,
												});
											}

											// Gross rate
											if (rate.latestGrossUnitRateCentsPerKwh !== undefined) {
												await this.setObjectNotExistsAsync(`${timeSlotPath}.grossRate`, {
													type: "state",
													common: {
														name: "Gross Rate (cents/kWh)",
														type: "number",
														role: "value.price",
														read: true,
														write: false,
														unit: "ct/kWh",
													},
													native: {},
												});
												await this.setStateAsync(`${timeSlotPath}.grossRate`, {
													val: rate.latestGrossUnitRateCentsPerKwh,
													ack: true,
												});
											}

											// Net rate
											if (rate.netUnitRateCentsPerKwh !== undefined) {
												await this.setObjectNotExistsAsync(`${timeSlotPath}.netRate`, {
													type: "state",
													common: {
														name: "Net Rate (cents/kWh)",
														type: "number",
														role: "value.price",
														read: true,
														write: false,
														unit: "ct/kWh",
													},
													native: {},
												});
												await this.setStateAsync(`${timeSlotPath}.netRate`, {
													val: rate.netUnitRateCentsPerKwh,
													ack: true,
												});
											}

											// Activation rules
											if (rate.timeslotActivationRules) {
												rate.timeslotActivationRules.forEach(async (rule, ruleIndex) => {
													if (rule.activeFromTime) {
														await this.setObjectNotExistsAsync(
															`${timeSlotPath}.activeFrom_${ruleIndex}`,
															{
																type: "state",
																common: {
																	name: "Active From Time",
																	type: "string",
																	role: "text",
																	read: true,
																	write: false,
																},
																native: {},
															},
														);
														await this.setStateAsync(`${timeSlotPath}.activeFrom_${ruleIndex}`, {
															val: rule.activeFromTime,
															ack: true,
														});
													}

													if (rule.activeToTime) {
														await this.setObjectNotExistsAsync(
															`${timeSlotPath}.activeTo_${ruleIndex}`,
															{
																type: "state",
																common: {
																	name: "Active To Time",
																	type: "string",
																	role: "text",
																	read: true,
																	write: false,
																},
																native: {},
															},
														);
														await this.setStateAsync(`${timeSlotPath}.activeTo_${ruleIndex}`, {
															val: rule.activeToTime,
															ack: true,
														});
													}
												});
											}
										});
									}
								}
							});
						}
					});
				}
			});

			this.log.debug("Pricing data processed successfully");
		} catch (error) {
			this.log.error(`Error processing pricing data: ${error.message}`);
		}
	}

	/**
	 * Process device alerts and send notifications for new alerts
	 * @param {Array} devices - Array of devices with alerts
	 */
	async processDeviceAlerts(devices) {
		if (!devices || !Array.isArray(devices)) {
			return;
		}

		// Track processed alerts to avoid duplicate notifications
		if (!this.processedAlerts) {
			this.processedAlerts = new Set();
		}

		devices.forEach((device, deviceIndex) => {
			if (device.alerts && Array.isArray(device.alerts)) {
				device.alerts.forEach((alert, alertIndex) => {
					if (alert.message && alert.publishedAt) {
						// Create unique alert ID
						const alertId = `${deviceIndex}-${alert.publishedAt}-${alert.message}`;

						// Check if alert is new
						if (!this.processedAlerts.has(alertId)) {
							this.processedAlerts.add(alertId);

							// Log alert
							this.log.warn(`Device Alert [${device.name || deviceIndex}]: ${alert.message} (${alert.publishedAt})`);

							// Create alert state
							const alertPath = `${this.name}.${this.instance}.devices.${deviceIndex}.alerts.${alertIndex}`;
							this.setObjectNotExists(
								alertPath,
								{
									type: "state",
									common: {
										name: "Alert Message",
										type: "string",
										role: "text",
										read: true,
										write: false,
									},
									native: {},
								},
								() => {
									this.setState(alertPath, {
										val: JSON.stringify(alert),
										ack: true,
									});
								},
							);

							// Send notification if adapter has notification capability
							// Note: This requires admin adapter to be running
							this.log.info(`New device alert: ${alert.message}`);
						}
					}
				});
			}
		});
	}

	/**
	 * Subscribe to device states for suspension control
	 * @param {Array} devices - Array of devices
	 */
	subscribeDeviceStates(devices) {
		if (!devices || !Array.isArray(devices)) {
			return;
		}

		// Track which devices we've already subscribed to
		if (!this.subscribedDevices) {
			this.subscribedDevices = new Set();
		}

		devices.forEach((device, index) => {
			const suspendedStatePath = `${this.name}.${this.instance}.devices.${index}.status.isSuspended`;

			// Only subscribe if we haven't already
			if (!this.subscribedDevices.has(suspendedStatePath)) {
				this.subscribeStates(suspendedStatePath);
				this.subscribedDevices.add(suspendedStatePath);
				this.log.debug(`Subscribed to device ${index}: ${suspendedStatePath}`);
			}
		});
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Clear the polling interval
			if (this.pollInterval) {
				this.log.info("Stopping polling interval");
				clearInterval(this.pollInterval);
				this.pollInterval = null;
			}

			// Clear the phase check interval
			if (this.phaseCheckInterval) {
				this.log.info("Stopping phase check interval");
				clearInterval(this.phaseCheckInterval);
				this.phaseCheckInterval = null;
			}

			// Stop the token manager auto-refresh
			if (this.octopusGermany && this.octopusGermany.stopTokenRefresh) {
				this.log.info("Stopping token refresh");
				this.octopusGermany.stopTokenRefresh();
			}

			// Shutdown AI Decision Engine
			if (this.aiEngine) {
				this.log.info("Shutting down AI Decision Engine");
				this.aiEngine.shutdown();
				this.aiEngine = null;
			}

			this.log.info("Adapter cleanup completed");
			callback();
		} catch (e) {
			this.log.error(`Error during cleanup: ${e}`);
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		// Validate state object
		if (!state) {
			this.log.debug(`State ${id} was deleted`);
			return;
		}

		// Only react to user changes (ack=false), not our own updates
		if (state.ack === true) {
			return;
		}

		this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

		// Check if this is a device suspension state change
		const deviceSuspendedPattern = new RegExp(
			`^${this.name}\\.${this.instance}\\.devices\\.(\\d+)\\.status\\.isSuspended$`,
		);
		const match = id.match(deviceSuspendedPattern);

		if (match) {
			const deviceIndex = match[1];
			const vehicleIdState = `${this.name}.${this.instance}.devices.${deviceIndex}.id`;
			this.log.debug(`Getting vehicle ID from state: ${vehicleIdState}`);

			try {
				const idState = await this.getStateAsync(vehicleIdState);

				if (idState && idState.val) {
					const carID = idState.val;
					const action = state.val === true ? "SUSPEND" : "UNSUSPEND";
					this.log.info(`Changing suspension for device ${deviceIndex} (ID: ${carID}): ${action}`);

					const result = await this.octopusGermany.changeDeviceSuspension(carID, action);

					if (result) {
						// Acknowledge the state change
						await this.setStateAsync(id, state.val, true);
						this.log.info(`Successfully ${action}ed device ${deviceIndex}`);
					} else {
						this.log.error(`Failed to ${action} device ${deviceIndex}`);
						// Reset state to previous value
						await this.setStateAsync(id, !state.val, true);
					}
				} else {
					this.log.warn(`Vehicle ID state ${vehicleIdState} not found or empty`);
				}
			} catch (err) {
				this.log.error(`Error handling suspension change for device ${deviceIndex}: ${err}`);
			}
		}
	}

	/**
	 * Diese Funktion verarbeitet ein JSON-Objekt und erstellt daraus Datenpunkte in ioBroker
	 * @param {object} jsonData - Das JSON-Objekt, das in Datenpunkte umgewandelt werden soll
	 * @param {string} basePath - Der Basispfad für die Datenpunkte (z.B. 'meinAdapter.meinOrdner')
	 */
	async createDataPointsFromJson(jsonData, basePath) {
		this.log.info(`Create Datapoints from JSON-Data under ${basePath}`);

		// Stelle sicher, dass der Basispfad existiert (als Channel)
		const basePathParts = basePath.split(".");
		const folderName = basePathParts[basePathParts.length - 1];

		this.setObjectNotExists(basePath, {
			type: "channel",
			common: {
				name: folderName,
			},
			native: {},
		});

		// Funktion zum rekursiven Durchlaufen des JSON-Objekts
		const processJsonObject = (obj, currentPath) => {
			for (const key in obj) {
				if (obj.hasOwnProperty(key)) {
					const value = obj[key];
					const dpPath = `${currentPath}.${key}`;

					if (value !== null && typeof value === "object" && !Array.isArray(value)) {
						// Wenn es sich um ein Objekt handelt, erstelle einen Channel und gehe rekursiv weiter
						this.setObjectNotExists(dpPath, {
							type: "channel",
							common: {
								name: key,
							},
							native: {},
						});

						processJsonObject(value, dpPath);
					} else if (Array.isArray(value)) {
						// Wenn es sich um ein Array handelt
						this.setObjectNotExists(dpPath, {
							type: "state",
							common: {
								name: key,
								type: "array",
								role: "json",
								read: true,
								write: true,
							},
							native: {},
						});

						// Setze den Wert als JSON-String
						this.setState(dpPath, { val: JSON.stringify(value), ack: true });

						// Optional: Erstelle individuelle Datenpunkte für Array-Elemente
						value.forEach((item, index) => {
							if (typeof item !== "object") {
								this.setObjectNotExists(`${dpPath}.${index}`, {
									type: "state",
									common: {
										name: `${key} [${index}]`,
										type: typeof item,
										role: "value",
										read: true,
										write: true,
									},
									native: {},
								});

								this.setState(`${dpPath}.${index}`, { val: item, ack: true });
							}
						});
					} else {
						// Bestimme den Datentyp und erstelle einen entsprechenden Datenpunkt
						let dataType = typeof value;
						let role = "value";

						// Spezifischere Rollen basierend auf Namen oder Werten zuweisen
						if (key.toLowerCase().includes("temp")) {
							role = "value.temperature";
						} else if (key.toLowerCase().includes("humidity") || key.toLowerCase().includes("feuchte")) {
							role = "value.humidity";
						} else if (dataType === "boolean") {
							role = "indicator";
						} else if (key.toLowerCase().includes("status")) {
							role = "text";
						}

						this.setObjectNotExists(dpPath, {
							type: "state",
							common: {
								name: key,
								type: dataType,
								role: role,
								read: true,
								write: true,
							},
							native: {},
						});

						// Only update state if value has changed
						this.getState(dpPath, (err, state) => {
							if (err || !state || state.val !== value) {
								this.setState(dpPath, { val: value, ack: true });
							}
						});
					}
				}
			}
		};

		// Starte die Verarbeitung
		processJsonObject(jsonData, basePath);
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Calamari(options);
} else {
	// otherwise start the instance directly
	new Calamari();
}
