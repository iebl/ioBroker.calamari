"use strict";

/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const OctopusGermany = require("./lib/octopusGermany");
const { AIDecisionEngine, SmartChargingPlanner } = require("./lib/aiMode");

const N = {
	triggerAiDecision:        { en: "Trigger AI Decision",                       de: "KI-Entscheidung auslösen",                        ru: "Запустить решение ИИ",                    pt: "Acionar decisão de IA",                     nl: "AI-beslissing activeren",           fr: "Déclencher une décision IA",          it: "Attiva decisione IA",                   es: "Activar decisión IA",                   pl: "Wyzwól decyzję AI",                        uk: "Запустити рішення ШІ",                   "zh-cn": "触发AI决策" },
	cheapPhaseChannel:        { en: "Cheap Electricity Phase",                   de: "Günstige Stromphase",                             ru: "Фаза дешёвой электроэнергии",             pt: "Fase de eletricidade barata",               nl: "Goedkope stroomfase",               fr: "Phase d'électricité bon marché",      it: "Fase di elettricità economica",         es: "Fase de electricidad barata",           pl: "Tania faza prądu",                        uk: "Фаза дешевої електроенергії",            "zh-cn": "廉价电力阶段" },
	cheapPhaseActive:         { en: "Currently in Cheap Phase",                  de: "Aktuell in günstiger Phase",                      ru: "Сейчас в дешёвой фазе",                   pt: "Atualmente em fase barata",                 nl: "Momenteel in goedkope fase",        fr: "Actuellement en phase bon marché",    it: "Attualmente in fase economica",         es: "Actualmente en fase barata",            pl: "Aktualnie w taniej fazie",                uk: "Зараз у дешевій фазі",                   "zh-cn": "当前处于廉价阶段" },
	currentPhaseChannel:      { en: "Current Phase Details",                     de: "Aktuelle Phase – Details",                        ru: "Текущая фаза – детали",                   pt: "Fase atual – detalhes",                     nl: "Huidige fase – details",            fr: "Phase actuelle – détails",            it: "Fase corrente – dettagli",              es: "Fase actual – detalles",                pl: "Aktualna faza – szczegóły",               uk: "Поточна фаза – деталі",                  "zh-cn": "当前阶段详情" },
	currentPhaseStart:        { en: "Current Phase Start Time",                  de: "Startzeit der aktuellen Phase",                   ru: "Время начала текущей фазы",               pt: "Hora de início da fase atual",              nl: "Starttijd huidige fase",            fr: "Heure de début de la phase actuelle", it: "Ora di inizio fase corrente",           es: "Hora de inicio de la fase actual",      pl: "Czas rozpoczęcia bieżącej fazy",          uk: "Час початку поточної фази",              "zh-cn": "当前阶段开始时间" },
	currentPhaseEnd:          { en: "Current Phase End Time",                    de: "Endzeit der aktuellen Phase",                     ru: "Время окончания текущей фазы",            pt: "Hora de fim da fase atual",                 nl: "Eindtijd huidige fase",             fr: "Heure de fin de la phase actuelle",   it: "Ora di fine fase corrente",             es: "Hora de fin de la fase actual",         pl: "Czas zakończenia bieżącej fazy",          uk: "Час закінчення поточної фази",           "zh-cn": "当前阶段结束时间" },
	currentPhaseEnergy:       { en: "Current Phase Energy (kWh)",                de: "Energie der aktuellen Phase (kWh)",               ru: "Энергия текущей фазы (кВт·ч)",           pt: "Energia da fase atual (kWh)",               nl: "Energie huidige fase (kWh)",        fr: "Énergie de la phase actuelle (kWh)",  it: "Energia fase corrente (kWh)",           es: "Energía de la fase actual (kWh)",       pl: "Energia bieżącej fazy (kWh)",             uk: "Енергія поточної фази (кВт·год)",        "zh-cn": "当前阶段电量 (kWh)" },
	currentPhaseRemaining:    { en: "Minutes Remaining in Current Phase",        de: "Verbleibende Minuten in aktueller Phase",         ru: "Оставшиеся минуты текущей фазы",         pt: "Minutos restantes na fase atual",           nl: "Resterende minuten huidige fase",   fr: "Minutes restantes dans la phase",     it: "Minuti rimanenti nella fase corrente",  es: "Minutos restantes en la fase actual",   pl: "Pozostałe minuty bieżącej fazy",          uk: "Хвилини, що залишилися у поточній фазі", "zh-cn": "当前阶段剩余分钟数" },
	nextPhaseChannel:         { en: "Next Phase Details",                        de: "Nächste Phase – Details",                         ru: "Следующая фаза – детали",                 pt: "Próxima fase – detalhes",                   nl: "Volgende fase – details",           fr: "Prochaine phase – détails",           it: "Fase successiva – dettagli",            es: "Próxima fase – detalles",               pl: "Następna faza – szczegóły",               uk: "Наступна фаза – деталі",                 "zh-cn": "下一阶段详情" },
	nextPhaseStart:           { en: "Next Phase Start Time",                     de: "Startzeit der nächsten Phase",                    ru: "Время начала следующей фазы",             pt: "Hora de início da próxima fase",            nl: "Starttijd volgende fase",           fr: "Heure de début de la prochaine phase",it: "Ora di inizio fase successiva",         es: "Hora de inicio de la próxima fase",     pl: "Czas rozpoczęcia następnej fazy",         uk: "Час початку наступної фази",             "zh-cn": "下一阶段开始时间" },
	nextPhaseEnd:             { en: "Next Phase End Time",                       de: "Endzeit der nächsten Phase",                      ru: "Время окончания следующей фазы",          pt: "Hora de fim da próxima fase",               nl: "Eindtijd volgende fase",            fr: "Heure de fin de la prochaine phase",  it: "Ora di fine fase successiva",           es: "Hora de fin de la próxima fase",        pl: "Czas zakończenia następnej fazy",         uk: "Час закінчення наступної фази",          "zh-cn": "下一阶段结束时间" },
	nextPhaseEnergy:          { en: "Next Phase Energy (kWh)",                   de: "Energie der nächsten Phase (kWh)",                ru: "Энергия следующей фазы (кВт·ч)",         pt: "Energia da próxima fase (kWh)",             nl: "Energie volgende fase (kWh)",       fr: "Énergie de la prochaine phase (kWh)", it: "Energia fase successiva (kWh)",         es: "Energía de la próxima fase (kWh)",      pl: "Energia następnej fazy (kWh)",            uk: "Енергія наступної фази (кВт·год)",       "zh-cn": "下一阶段电量 (kWh)" },
	nextPhaseMinutes:         { en: "Minutes Until Next Phase",                  de: "Minuten bis zur nächsten Phase",                  ru: "Минут до следующей фазы",                 pt: "Minutos até a próxima fase",                nl: "Minuten tot volgende fase",         fr: "Minutes avant la prochaine phase",    it: "Minuti alla prossima fase",             es: "Minutos hasta la próxima fase",         pl: "Minuty do następnej fazy",                uk: "Хвилин до наступної фази",               "zh-cn": "距下一阶段分钟数" },
	pricingChannel:           { en: "Electricity Pricing",                       de: "Strompreise",                                     ru: "Тарифы на электроэнергию",                pt: "Preços de eletricidade",                    nl: "Elektriciteitsprijzen",             fr: "Tarifs d'électricité",                it: "Prezzi dell'elettricità",               es: "Precios de electricidad",               pl: "Ceny energii elektrycznej",               uk: "Тарифи на електроенергію",               "zh-cn": "电价信息" },
	grossRateCurrent:         { en: "Current Gross Rate (ct/kWh)",               de: "Aktueller Bruttostrompreis (ct/kWh)",             ru: "Текущий тариф брутто (цент/кВт·ч)",      pt: "Tarifa bruta atual (ct/kWh)",               nl: "Huidige brutotarief (ct/kWh)",      fr: "Tarif brut actuel (ct/kWh)",          it: "Tariffa lorda attuale (ct/kWh)",        es: "Tarifa bruta actual (ct/kWh)",          pl: "Bieżąca stawka brutto (ct/kWh)",          uk: "Поточний тариф брутто (цент/кВт·год)",   "zh-cn": "当前含税电价 (ct/kWh)" },
	netRateCurrent:           { en: "Current Net Rate (ct/kWh)",                 de: "Aktueller Nettostrompreis (ct/kWh)",              ru: "Текущий тариф нетто (цент/кВт·ч)",       pt: "Tarifa líquida atual (ct/kWh)",             nl: "Huidige nettotarief (ct/kWh)",      fr: "Tarif net actuel (ct/kWh)",           it: "Tariffa netta attuale (ct/kWh)",        es: "Tarifa neta actual (ct/kWh)",           pl: "Bieżąca stawka netto (ct/kWh)",           uk: "Поточний тариф нетто (цент/кВт·год)",    "zh-cn": "当前不含税电价 (ct/kWh)" },
	timeslotName:             { en: "Timeslot Name",                             de: "Zeitfenster-Name",                                ru: "Название временного слота",               pt: "Nome do período",                           nl: "Naam tijdslot",                     fr: "Nom du créneau horaire",              it: "Nome dell'intervallo",                  es: "Nombre del intervalo horario",          pl: "Nazwa przedziału czasowego",              uk: "Назва часового слоту",                   "zh-cn": "时段名称" },
	grossRate:                { en: "Gross Rate (ct/kWh)",                       de: "Bruttostrompreis (ct/kWh)",                       ru: "Тариф брутто (цент/кВт·ч)",              pt: "Tarifa bruta (ct/kWh)",                     nl: "Brutotarief (ct/kWh)",              fr: "Tarif brut (ct/kWh)",                 it: "Tariffa lorda (ct/kWh)",                es: "Tarifa bruta (ct/kWh)",                 pl: "Stawka brutto (ct/kWh)",                  uk: "Тариф брутто (цент/кВт·год)",            "zh-cn": "含税电价 (ct/kWh)" },
	netRate:                  { en: "Net Rate (ct/kWh)",                         de: "Nettostrompreis (ct/kWh)",                        ru: "Тариф нетто (цент/кВт·ч)",               pt: "Tarifa líquida (ct/kWh)",                   nl: "Nettotarief (ct/kWh)",              fr: "Tarif net (ct/kWh)",                  it: "Tariffa netta (ct/kWh)",                es: "Tarifa neta (ct/kWh)",                  pl: "Stawka netto (ct/kWh)",                   uk: "Тариф нетто (цент/кВт·год)",             "zh-cn": "不含税电价 (ct/kWh)" },
	activeFrom:               { en: "Active From Time",                          de: "Aktiv ab",                                        ru: "Активно с",                               pt: "Ativo a partir de",                         nl: "Actief vanaf",                      fr: "Actif à partir de",                   it: "Attivo dalle",                          es: "Activo desde",                          pl: "Aktywne od",                              uk: "Активно з",                              "zh-cn": "开始时间" },
	activeTo:                 { en: "Active To Time",                            de: "Aktiv bis",                                       ru: "Активно до",                              pt: "Ativo até",                                 nl: "Actief tot",                        fr: "Actif jusqu'à",                       it: "Attivo fino alle",                      es: "Activo hasta",                          pl: "Aktywne do",                              uk: "Активно до",                             "zh-cn": "结束时间" },
};

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
		this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));

		// Instanz der OctopusGermany-Klasse erstellen

		this.octopusGermany = new OctopusGermany(this);

		// Store for planned dispatches
		this.plannedDispatches = [];

		// AI Decision Engine (initialized in onReady if enabled)
		this.aiEngine = null;

		// Smart Charging Planner (initialized in onReady if enabled)
		this.smartChargingPlanner = null;

		// Charging monitoring
		this.chargingMonitoringInterval = null;
		this.lastMonitoringNotification = null;
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

					// Create trigger state for manual AI decision
					await this.setObjectNotExistsAsync("aiMode.triggerDecision", {
						type: "state",
						common: {
							name: N.triggerAiDecision,
							type: "boolean",
							role: "button",
							read: true,
							write: true,
						},
						native: {},
					});
					await this.setStateAsync("aiMode.triggerDecision", false, true);

					// Subscribe to trigger state
					this.subscribeStates("aiMode.triggerDecision");
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

			// Initialize Smart Charging Planner if enabled
			if (this.config.enableSmartCharging) {
				this.log.info("Smart Charging Planner is enabled, initializing...");
				try {
					this.smartChargingPlanner = new SmartChargingPlanner(this, this.config);
					await this.smartChargingPlanner.initialize();
					this.subscribeStates("smartCharging.triggerCalculation");
					this.log.info("Smart Charging Planner initialized successfully");
				} catch (error) {
					this.log.error(`Failed to initialize Smart Charging Planner: ${error.message}`);
					this.log.warn("Continuing without Smart Charging Planner");
				}
			} else {
				this.log.debug("Smart Charging Planner is disabled");
			}

			// Initialize charging monitoring if enabled
			if (this.config.enableChargingMonitoring) {
				this.log.info("Smart Charging Monitoring is enabled");
				// Start monitoring interval - check every 30 minutes
				this.chargingMonitoringInterval = setInterval(() => {
					this.checkChargingStatus();
				}, 30 * 60 * 1000); // 30 minutes

				// Initial check after 1 minute
				setTimeout(() => {
					this.checkChargingStatus();
				}, 60000);
			}
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
				name: N.cheapPhaseChannel,
			},
			native: {},
		});

		// Main state: Are we currently in a cheap phase?
		await this.setObjectNotExistsAsync(`${basePath}.active`, {
			type: "state",
			common: {
				name: N.cheapPhaseActive,
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
				name: N.currentPhaseChannel,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.current.start`, {
			type: "state",
			common: {
				name: N.currentPhaseStart,
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
				name: N.currentPhaseEnd,
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
				name: N.currentPhaseEnergy,
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
				name: N.currentPhaseRemaining,
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
				name: N.nextPhaseChannel,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync(`${basePath}.next.start`, {
			type: "state",
			common: {
				name: N.nextPhaseStart,
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
				name: N.nextPhaseEnd,
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
				name: N.nextPhaseEnergy,
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
				name: N.nextPhaseMinutes,
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
				const remainingMs = end.getTime() - now.getTime();
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
				const untilStartMs = start.getTime() - now.getTime();
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
					name: N.pricingChannel,
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
													name: N.grossRateCurrent,
													type: "number",
													role: "value.price",
													read: true,
													write: false,
													unit: "ct/kWh",
												},
												native: {},
											});
											await this.setStateAsync(`${ratePath}.grossRate`, {
												val: parseFloat(rateInfo.latestGrossUnitRateCentsPerKwh),
												ack: true,
											});
										}

										if (rateInfo.netUnitRateCentsPerKwh !== undefined) {
											await this.setObjectNotExistsAsync(`${ratePath}.netRate`, {
												type: "state",
												common: {
													name: N.netRateCurrent,
													type: "number",
													role: "value.price",
													read: true,
													write: false,
													unit: "ct/kWh",
												},
												native: {},
											});
											await this.setStateAsync(`${ratePath}.netRate`, {
												val: parseFloat(rateInfo.netUnitRateCentsPerKwh),
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
														name: N.timeslotName,
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
														name: N.grossRate,
														type: "number",
														role: "value.price",
														read: true,
														write: false,
														unit: "ct/kWh",
													},
													native: {},
												});
												await this.setStateAsync(`${timeSlotPath}.grossRate`, {
													val: parseFloat(rate.latestGrossUnitRateCentsPerKwh),
													ack: true,
												});
											}

											// Net rate
											if (rate.netUnitRateCentsPerKwh !== undefined) {
												await this.setObjectNotExistsAsync(`${timeSlotPath}.netRate`, {
													type: "state",
													common: {
														name: N.netRate,
														type: "number",
														role: "value.price",
														read: true,
														write: false,
														unit: "ct/kWh",
													},
													native: {},
												});
												await this.setStateAsync(`${timeSlotPath}.netRate`, {
													val: parseFloat(rate.netUnitRateCentsPerKwh),
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
																	name: N.activeFrom,
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
																	name: N.activeTo,
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
	 * Send notification via Telegram and Signal
	 * @param {string} message - The message to send
	 */
	async sendNotification(message) {
		// Send via Telegram if configured
		if (this.config.telegramInstance && this.config.telegramUser) {
			try {
				await this.sendToAsync(this.config.telegramInstance, {
					user: this.config.telegramUser,
					text: message,
				});
				this.log.debug(`Telegram notification sent to ${this.config.telegramUser}`);
			} catch (error) {
				this.log.error(`Failed to send Telegram notification: ${error.message}`);
			}
		}

		// Send via Signal if configured
		if (this.config.signalInstance && this.config.telegramUser) {
			try {
				await this.sendToAsync(this.config.signalInstance, {
					user: this.config.telegramUser,
					text: message,
				});
				this.log.debug(`Signal notification sent to ${this.config.telegramUser}`);
			} catch (error) {
				this.log.error(`Failed to send Signal notification: ${error.message}`);
			}
		}
	}

	/**
	 * Check if current time is after configured monitoring start time
	 * @returns {boolean} - True if monitoring should be active
	 */
	isMonitoringTime() {
		const now = new Date();
		const currentHours = now.getHours();
		const currentMinutes = now.getMinutes();
		const currentTimeMinutes = currentHours * 60 + currentMinutes;

		// Parse monitoring start time (HH:MM)
		const timeParts = this.config.monitoringStartTime.split(":");
		if (timeParts.length !== 2) {
			this.log.warn(`Invalid monitoring start time format: ${this.config.monitoringStartTime}`);
			return false;
		}

		const startHours = parseInt(timeParts[0], 10);
		const startMinutes = parseInt(timeParts[1], 10);
		const startTimeMinutes = startHours * 60 + startMinutes;

		return currentTimeMinutes >= startTimeMinutes;
	}

	/**
	 * Check charging status and send notification if needed
	 */
	async checkChargingStatus() {
		try {
			// Only monitor if current time is after configured start time
			if (!this.isMonitoringTime()) {
				this.log.debug("Not yet monitoring time, skipping check");
				return;
			}

			// Check if we already sent a notification today
			const now = new Date();
			if (this.lastMonitoringNotification) {
				const lastNotificationDate = new Date(this.lastMonitoringNotification);
				if (
					lastNotificationDate.getDate() === now.getDate() &&
					lastNotificationDate.getMonth() === now.getMonth() &&
					lastNotificationDate.getFullYear() === now.getFullYear()
				) {
					this.log.debug("Already sent notification today, skipping");
					return;
				}
			}

			// Get vehicle SoC from evcc
			const loadpointIndex = this.config.evccLoadpointIndex || 0;
			const vehicleSocPath = `${this.config.evccInstance}.loadpoint.${loadpointIndex}.vehicleSoc`;
			const vehicleSocState = await this.getForeignStateAsync(vehicleSocPath);

			if (!vehicleSocState || vehicleSocState.val === null) {
				this.log.warn(`Vehicle SoC state not found or empty: ${vehicleSocPath}`);
				return;
			}

			const vehicleSoc = parseFloat(vehicleSocState.val);
			this.log.debug(`Current vehicle SoC: ${vehicleSoc}%`);

			// Only continue if vehicle SoC is below minimum
			if (vehicleSoc >= this.config.minVehicleSoc) {
				this.log.debug(`Vehicle SoC (${vehicleSoc}%) is above minimum (${this.config.minVehicleSoc}%), no action needed`);
				return;
			}

			this.log.info(`Vehicle SoC (${vehicleSoc}%) is below minimum (${this.config.minVehicleSoc}%), checking charging status...`);

			// Check evcc mode
			const evccModePath = `${this.config.evccInstance}.loadpoint.${loadpointIndex}.mode`;
			const evccModeState = await this.getForeignStateAsync(evccModePath);

			if (!evccModeState || evccModeState.val === null) {
				this.log.warn(`EVCC mode state not found: ${evccModePath}`);
				return;
			}

			const evccMode = String(evccModeState.val);
			this.log.debug(`Current EVCC mode: ${evccMode}`);

			// Check calamari suspension status
			const suspendedPath = `${this.name}.${this.instance}.devices.0.status.isSuspended`;
			const suspendedState = await this.getStateAsync("devices.0.status.isSuspended");

			let isSuspended = true;
			if (suspendedState && suspendedState.val !== null) {
				isSuspended = suspendedState.val === true;
				this.log.debug(`Octopus smart charging suspended: ${isSuspended}`);
			} else {
				this.log.warn(`Suspension state not found: ${suspendedPath}`);
			}

			// Determine if smart charging is active
			const isChargingActive = evccMode === "now" && !isSuspended;

			if (!isChargingActive) {
				// Send notification
				const message =
					`⚠️ WARNUNG: Smartes Laden nicht aktiv!\n\n` +
					`Ladestand: ${vehicleSoc}% (unter ${this.config.minVehicleSoc}%)\n` +
					`EVCC Modus: ${evccMode} ${evccMode !== "now" ? "❌" : "✅"}\n` +
					`Octopus Suspended: ${isSuspended ? "JA ❌" : "NEIN ✅"}\n\n` +
					`Smartes Laden sollte aktiv sein:\n` +
					`- EVCC Modus: "now"\n` +
					`- Octopus Suspended: false\n\n` +
					`Zeit: ${now.toLocaleString("de-DE")}`;

				await this.sendNotification(message);
				this.lastMonitoringNotification = now.toISOString();
				this.log.warn("Sent charging monitoring notification");
			} else {
				this.log.info("Smart charging is active, all good!");
			}
		} catch (error) {
			this.log.error(`Error checking charging status: ${error.message}`);
			this.log.error(error.stack);
		}
	}

	/**
	 * Handle messages from admin UI
	 * @param {ioBroker.Message} obj
	 */
	async onMessage(obj) {
		if (!obj) {
			this.log.debug('onMessage: obj is null or undefined');
			return;
		}

		if (!obj.command) {
			this.log.debug(`onMessage: no command in object`);
			return;
		}

		// Ignore responses from other adapters (like history adapter responses to our sendTo calls)
		// These have callback.ack = true and come from other adapters
		if (obj.callback && obj.callback.ack === true) {
			this.log.debug(`Ignoring response from ${obj.from} for command ${obj.command}`);
			return;
		}

		this.log.debug(`Processing command: ${obj.command} from ${obj.from}`);

		try {
			switch (obj.command) {
				case 'testClaudeConnection':
					try {
						this.log.info('Testing Claude AI connection from Admin UI...');
						this.log.debug(`API Key present: ${!!obj.message?.apiKey}`);
						this.log.debug(`Model: ${obj.message?.model}`);

						// Create a temporary Claude AI client with the provided credentials
						const { Anthropic } = require('@anthropic-ai/sdk');
						const testClient = new Anthropic({
							apiKey: obj.message.apiKey
						});

						const startTime = Date.now();
						const message = await testClient.messages.create({
							model: obj.message.model || 'claude-3-5-sonnet-20241022',
							max_tokens: 50,
							messages: [{
								role: 'user',
								content: 'Please respond with "Connection successful" if you receive this message.'
							}]
						});
						const duration = Date.now() - startTime;

						this.log.info(`Claude AI test successful (${duration}ms)`);

						// Extract text from content blocks (handle new SDK structure)
						const textContent = message.content.find(block => block.type === 'text');
						const responseText = textContent && textContent.type === 'text' ? textContent.text : 'No text response';

						const response = {
							success: true,
							message: `✅ Connection successful!\n\nModel: ${obj.message.model}\nResponse time: ${duration}ms\nResponse: "${responseText}"`
						};

						this.log.debug(`Sending success response via callback`);
						if (obj.callback) {
							this.sendTo(obj.from, obj.command, response, obj.callback);
						}
						return response;
					} catch (error) {
						this.log.error(`Claude AI test failed: ${error.message}`);

						const errorResponse = {
							success: false,
							message: `❌ Connection failed:\n\n${error.message}\n\nPlease check your API key and try again.`
						};

						this.log.debug(`Sending error response via callback`);
						if (obj.callback) {
							this.sendTo(obj.from, obj.command, errorResponse, obj.callback);
						}
						return errorResponse;
					}

				default:
					this.log.warn(`Unknown command: ${obj.command}`);
					const unknownResponse = { error: 'Unknown command' };
					if (obj.callback) {
						this.sendTo(obj.from, obj.command, unknownResponse, obj.callback);
					}
					return unknownResponse;
			}
		} catch (error) {
			this.log.error(`Error in onMessage: ${error.message}`);
			this.log.error(error.stack);
		}
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

			// Shutdown Smart Charging Planner
			if (this.smartChargingPlanner) {
				this.log.info("Shutting down Smart Charging Planner");
				this.smartChargingPlanner.shutdown();
				this.smartChargingPlanner = null;
			}

			// Clear charging monitoring interval
			if (this.chargingMonitoringInterval) {
				this.log.info("Stopping charging monitoring interval");
				clearInterval(this.chargingMonitoringInterval);
				this.chargingMonitoringInterval = null;
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

		// Check if this is the Smart Charging manual trigger
		if (id === `${this.name}.${this.instance}.smartCharging.triggerCalculation` && state.val === true) {
			this.log.info("Manual Smart Charging calculation triggered by user");
			if (this.smartChargingPlanner) {
				try {
					await this.smartChargingPlanner.calculate();
					this.log.info("Manual Smart Charging calculation completed");
				} catch (error) {
					this.log.error(`Manual Smart Charging calculation failed: ${error.message}`);
				}
			} else {
				this.log.warn("Smart Charging Planner not initialized - enable it in configuration");
			}
			await this.setStateAsync(id, false, true);
			return;
		}

		// Check if this is the AI trigger state
		if (id === `${this.name}.${this.instance}.aiMode.triggerDecision` && state.val === true) {
			this.log.info("Manual AI decision triggered by user");

			if (this.aiEngine) {
				try {
					await this.aiEngine.makeDecision();
					this.log.info("Manual AI decision completed successfully");
				} catch (error) {
					this.log.error(`Manual AI decision failed: ${error.message}`);
				}
			} else {
				this.log.warn("AI Engine not initialized - enable AI Mode in configuration");
			}

			// Reset trigger state
			await this.setStateAsync(id, false, true);
			return;
		}

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
