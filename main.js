"use strict";

/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const OctopusGermany = require("./lib/octopusGermany");

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
		this.octopusGermany.initialize(this.config.email, this.config.password);
		this.octopusGermany.login();

		const allData = await this.octopusGermany.fetchAllData(this.config.account);

		this.createDataPointsFromJson.call(this, allData.account, this.name + "." + this.instance + ".account");
		this.createDataPointsFromJson.call(this, allData.devices, this.name + "." + this.instance + ".devices");
		this.createDataPointsFromJson.call(
			this,
			allData.plannedDispatches,
			this.name + "." + this.instance + ".plannedDispatches",
		);
		this.createDataPointsFromJson.call(
			this,
			allData.completedDispatches,
			this.name + "." + this.instance + ".completedDispatches",
		);

		this.subscribeStates(this.name + "." + this.instance + ".devices.0.status.isSuspended");
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);

			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state && !state.ack) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

			if (id == this.name + "." + this.instance + ".devices.0.status.isSuspended") {
				const vehicleIdState = this.name + "." + this.instance + ".devices.0.id";
				console.log(vehicleIdState);

				// getStateAsync gibt ein Promise zurück und muss mit then/catch oder async/await behandelt werden
				this.getStateAsync(vehicleIdState)
					.then((idState) => {
						if (idState && idState.val) {
							const carID = idState.val;
							console.log(carID);
							if (state.val == true) {
								this.octopusGermany.changeDeviceSuspension(carID, "SUSPEND");
							} else {
								this.octopusGermany.changeDeviceSuspension(carID, "UNSUSPEND");
							}
						} else {
							this.log.warn(`Vehicle ID state ${vehicleIdState} not found or empty`);
						}
					})
					.catch((err) => {
						this.log.error(`Error getting vehicle ID: ${err}`);
					});
			}
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
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

						// Setze den Wert
						this.setState(dpPath, { val: value, ack: true });
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
