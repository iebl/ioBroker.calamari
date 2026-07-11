/**
 * AI Mode Module for ioBroker.calamari
 *
 * This module provides intelligent battery charging decisions based on:
 * - Weather forecasts from brightsky adapter (Deutscher Wetterdienst)
 * - PV production predictions
 * - Current consumption data from evcc adapter states
 * - Electricity price dispatches from Octopus
 * - Historical consumption patterns from History adapter
 * - Claude AI analysis
 */

const axios = require('axios');
const { Anthropic } = require('@anthropic-ai/sdk');

/**
 * Weather Service - Fetches weather forecasts from brightsky ioBroker adapter (Deutscher Wetterdienst)
 */
class WeatherService {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._brightskyInstance = config.brightskyInstance || 'brightsky.0';
	}

	/**
	 * Fetch weather forecast from brightsky adapter
	 * Note: brightsky provides only 13 hours of forecast (hourly.00 to hourly.13)
	 * @returns {Promise<Array>} Hourly forecast data (max 13 hours)
	 */
	async getForecast() {
		try {
			this._adapter.log.debug(`Fetching forecast from brightsky adapter: ${this._brightskyInstance}`);

			const hourlyData = [];
			const maxHours = 14; // brightsky provides 0-13 (14 hours total)

			// brightsky adapter stores hourly forecasts in hourly.XX.* structure (with leading zero)
			for (let hour = 0; hour < maxHours; hour++) {
				try {
					// Format hour with leading zero (00, 01, 02, ...)
					const hourStr = hour.toString().padStart(2, '0');
					const basePath = `${this._brightskyInstance}.hourly.${hourStr}`;

					// Read forecast data for this hour
					const timestampState = await this._adapter.getForeignStateAsync(`${basePath}.timestamp`);
					const tempState = await this._adapter.getForeignStateAsync(`${basePath}.temperature`);
					const cloudState = await this._adapter.getForeignStateAsync(`${basePath}.cloud_cover`);
					const precipState = await this._adapter.getForeignStateAsync(`${basePath}.precipitation`);
					const windState = await this._adapter.getForeignStateAsync(`${basePath}.wind_speed`);
					const conditionState = await this._adapter.getForeignStateAsync(`${basePath}.condition`);

					// Solar-relevant data for PV forecasting (brightsky provides DWD data)
					const solarState = await this._adapter.getForeignStateAsync(`${basePath}.solar`);
					const solarEstimateState = await this._adapter.getForeignStateAsync(`${basePath}.solar_estimate`);
					const sunshineState = await this._adapter.getForeignStateAsync(`${basePath}.sunshine`);
					const visibilityState = await this._adapter.getForeignStateAsync(`${basePath}.visibility`);

					// Skip if no data available for this hour
					if (!timestampState || !tempState) continue;

					hourlyData.push({
						timestamp: new Date(timestampState.val),
						temperature: tempState.val || 15, // Fallback to 15°C
						cloudCoverage: cloudState?.val || 50, // 0-100%
						description: conditionState?.val || 'Unknown',
						precipitation: precipState?.val || 0, // mm
						windSpeed: windState?.val || 0, // m/s
						// Solar data for PV production forecasting (from DWD via brightsky)
						solarIrradiation: solarState?.val || solarEstimateState?.val || null, // kWh/m²
						sunshineDuration: sunshineState?.val || null, // minutes
						visibility: visibilityState?.val || null // meters
					});
				} catch (error) {
					this._adapter.log.debug(`Could not read forecast hour ${hour}: ${error.message}`);
				}
			}

			if (hourlyData.length === 0) {
				this._adapter.log.warn('No weather forecast data available from brightsky adapter');
				// Return fallback data
				return this._getFallbackForecast();
			}

			this._adapter.log.info(`Successfully fetched ${hourlyData.length} hours of weather forecast from brightsky (13h rolling window)`);
			return hourlyData;

		} catch (error) {
			this._adapter.log.error(`Weather forecast fetch failed: ${error.message}`);
			return this._getFallbackForecast();
		}
	}

	/**
	 * Generate fallback forecast data if brightsky is not available
	 */
	_getFallbackForecast() {
		this._adapter.log.warn('Using fallback weather forecast (partly cloudy, 15°C) - Check brightsky adapter configuration and state names');
		const hourlyData = [];
		const now = new Date();

		for (let i = 0; i < 14; i++) { // Match brightsky's 13h forecast (0-13)
			const timestamp = new Date(now.getTime() + i * 60 * 60 * 1000);
			hourlyData.push({
				timestamp,
				temperature: 15,
				cloudCoverage: 50,
				description: 'Partly cloudy (fallback)',
				precipitation: 0,
				windSpeed: 3,
				solarIrradiation: null,
				sunshineDuration: null,
				visibility: null
			});
		}

		return hourlyData;
	}
}

/**
 * PV Forecast - Calculates expected PV production based on weather and system configuration
 */
class PVForecast {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._arrays = [];

		// Configure PV arrays
		if (config.pvArray1Enabled) {
			this._arrays.push({
				power: config.pvArray1Power,
				orientation: config.pvArray1Orientation,
				tilt: config.pvArray1Tilt
			});
		}
		if (config.pvArray2Enabled) {
			this._arrays.push({
				power: config.pvArray2Power,
				orientation: config.pvArray2Orientation,
				tilt: config.pvArray2Tilt
			});
		}
		if (config.pvArray3Enabled) {
			this._arrays.push({
				power: config.pvArray3Power,
				orientation: config.pvArray3Orientation,
				tilt: config.pvArray3Tilt
			});
		}

		this._lat = config.locationLat;
	}

	/**
	 * Calculate PV production forecast based on weather data
	 * @param {Array} weatherForecast - Hourly weather forecast
	 * @returns {Array} Hourly PV production forecast in kWh
	 */
	calculateProduction(weatherForecast) {
		return weatherForecast.map(hour => {
			const totalProduction = this._arrays.reduce((sum, array) => {
				return sum + this._calculateArrayProduction(hour, array);
			}, 0);

			return {
				timestamp: hour.timestamp,
				estimatedKwh: totalProduction,
				cloudCoverage: hour.cloudCoverage,
				temperature: hour.temperature
			};
		});
	}

	/**
	 * Calculate production for a single PV array
	 */
	_calculateArrayProduction(weather, array) {
		const hour = weather.timestamp.getHours();

		// Use actual solar irradiation from brightsky if available, otherwise estimate
		let solarIrradiance;
		if (weather.solarIrradiation !== null && weather.solarIrradiation !== undefined) {
			// brightsky provides solar irradiation in kWh/m²
			// Normalize to a 0-1 factor (assuming max ~1 kWh/m² per hour)
			solarIrradiance = Math.min(1.0, weather.solarIrradiation / 1.0);
		} else {
			// Fallback to estimation if no actual data available
			solarIrradiance = this._estimateSolarIrradiance(hour, weather.timestamp, weather.cloudCoverage);
		}

		// Orientation factor
		const orientationFactor = this._getOrientationFactor(hour, array.orientation);

		// Tilt factor (simplified)
		const tiltFactor = this._getTiltFactor(array.tilt, this._lat);

		// Temperature derating (PV efficiency decreases with temperature)
		const tempDerating = 1 - ((weather.temperature - 25) * 0.004);

		// Cloud coverage derating - only apply if we don't have actual solar data
		const cloudDerating = (weather.solarIrradiation !== null && weather.solarIrradiation !== undefined)
			? 1.0 // Don't apply cloud derating if we have actual solar irradiation
			: 1 - (weather.cloudCoverage / 100 * 0.75);

		// Calculate production in kW, then convert to kWh for 1 hour
		const production = array.power * solarIrradiance * orientationFactor * tiltFactor * tempDerating * cloudDerating;

		return Math.max(0, production); // Ensure non-negative
	}

	/**
	 * Estimate solar irradiance based on time of day and cloud coverage
	 * Returns a factor between 0 and 1 representing percentage of peak irradiance
	 */
	_estimateSolarIrradiance(hour, date, cloudCoverage) {
		// Night time
		if (hour < 5 || hour > 21) return 0;

		// Get day of year for seasonal adjustment
		const dayOfYear = this._getDayOfYear(date);
		const seasonalFactor = 0.7 + 0.3 * Math.cos((dayOfYear - 172) * 2 * Math.PI / 365);

		// Simple bell curve for daily solar pattern
		// Peak at solar noon (around 13:00)
		const solarNoon = 13;
		const hourFromNoon = Math.abs(hour - solarNoon);
		const dailyPattern = Math.max(0, Math.cos(hourFromNoon * Math.PI / 12));

		return dailyPattern * seasonalFactor;
	}

	/**
	 * Get orientation factor based on time of day
	 * East performs better in morning, West in evening, South at noon
	 */
	_getOrientationFactor(hour, orientation) {
		const factors = {
			'N': 0.5,
			'NE': hour < 12 ? 0.7 : 0.5,
			'E': hour < 10 ? 1.0 : hour < 14 ? 0.7 : 0.4,
			'SE': hour < 12 ? 0.9 : 0.7,
			'S': hour >= 10 && hour <= 16 ? 1.0 : 0.6,
			'SW': hour > 12 ? 0.9 : 0.7,
			'W': hour > 14 ? 1.0 : hour > 10 ? 0.7 : 0.4,
			'NW': hour > 12 ? 0.7 : 0.5
		};
		return factors[orientation] || 0.7;
	}

	/**
	 * Get tilt factor based on panel tilt and latitude
	 */
	_getTiltFactor(tilt, latitude) {
		// Optimal tilt is approximately equal to latitude
		// This is a simplified model
		const optimalTilt = Math.abs(latitude);
		const tiltDifference = Math.abs(tilt - optimalTilt);

		// Flat panels (0°) are less efficient except in summer
		if (tilt === 0) return 0.85;

		// Reduce efficiency based on deviation from optimal
		return Math.max(0.7, 1 - (tiltDifference / 100));
	}

	/**
	 * Get day of year (1-365)
	 */
	_getDayOfYear(date) {
		const start = new Date(date.getFullYear(), 0, 0);
		const diff = date.getTime() - start.getTime();
		const oneDay = 1000 * 60 * 60 * 24;
		return Math.floor(diff / oneDay);
	}
}

/**
 * EVCC Adapter Client - Reads data from evcc ioBroker adapter states
 */
class EVCCAdapter {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._config = config;
		this._evccInstance = config.evccInstance || 'evcc.0';
		this._data = {
			pvPower: 0,
			batteryPower: 0,
			batterySoc: 0,
			gridPower: 0,
			homePower: 0
		};
	}

	/**
	 * Initialize and check if evcc adapter states are available
	 */
	async connect() {
		try {
			this._adapter.log.info(`Initializing evcc adapter client: ${this._evccInstance}`);

			// Try to read initial data to verify states exist
			await this._readCurrentData();

			// Check if we got any meaningful data
			if (this._data.batterySoc > 0 || this._data.homePower > 0) {
				this._adapter.log.info(`Successfully connected to evcc adapter states`);
				return true;
			} else {
				this._adapter.log.warn(`evcc adapter states exist but contain no data (all values are 0)`);
				return true; // Still return true as states exist
			}
		} catch (error) {
			this._adapter.log.error(`Failed to initialize evcc adapter client: ${error.message}`);
			return false;
		}
	}

	/**
	 * Read current data from evcc adapter states
	 */
	async _readCurrentData() {
		try {
			// Read from evcc.X.status.* states (using actual evcc state names)
			const pvState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.pv`);
			const batteryPowerState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.batteryPower`);
			const batterySocState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.batterySoc`);
			const gridState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.grid`);
			const homeState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.homePower`);

			// Track which states are missing
			const missingStates = [];
			if (!pvState || pvState.val === null) missingStates.push(`${this._evccInstance}.status.pv`);
			if (!batteryPowerState || batteryPowerState.val === null) missingStates.push(`${this._evccInstance}.status.batteryPower`);
			if (!batterySocState || batterySocState.val === null) missingStates.push(`${this._evccInstance}.status.batterySoc`);
			if (!gridState || gridState.val === null) missingStates.push(`${this._evccInstance}.status.grid`);
			if (!homeState || homeState.val === null) missingStates.push(`${this._evccInstance}.status.homePower`);

			if (missingStates.length > 0) {
				this._adapter.log.warn(`Missing or null evcc states: ${missingStates.join(', ')}`);
			}

			if (pvState && pvState.val !== null) this._data.pvPower = pvState.val;
			if (batteryPowerState && batteryPowerState.val !== null) this._data.batteryPower = batteryPowerState.val;
			if (batterySocState && batterySocState.val !== null) this._data.batterySoc = batterySocState.val;
			if (gridState && gridState.val !== null) this._data.gridPower = gridState.val;
			if (homeState && homeState.val !== null) this._data.homePower = homeState.val;

			this._adapter.log.debug(`EVCC data read: PV=${this._data.pvPower}W, Battery=${this._data.batteryPower}W (${this._data.batterySoc}%), Grid=${this._data.gridPower}W, Home=${this._data.homePower}W`);
		} catch (error) {
			this._adapter.log.error(`Error reading evcc data: ${error.message}`);
		}
	}

	/**
	 * Get current evcc data (refreshes before returning)
	 */
	async getData() {
		await this._readCurrentData();
		return { ...this._data };
	}

	/**
	 * Cleanup (no-op for state-based client)
	 */
	disconnect() {
		this._adapter.log.info('EVCCAdapter client cleanup complete');
	}
}

/**
 * Claude AI Client - Makes intelligent decisions based on all available data
 */
class ClaudeAI {
	// Mapping of model types to their latest versions
	// Update these version strings when new models are released
	static MODEL_VERSIONS = {
		'sonnet': 'claude-sonnet-4-5-20250929',  // Latest Sonnet 4.5
		'haiku': 'claude-3-5-haiku-20241022'      // Latest Haiku
	};

	constructor(adapter, config) {
		this._adapter = adapter;
		this._apiKey = config.claudeApiKey;

		// Map model type to actual model version
		const modelType = config.claudeModel || 'sonnet';
		this._model = ClaudeAI.MODEL_VERSIONS[modelType] || ClaudeAI.MODEL_VERSIONS['sonnet'];

		this._adapter.log.debug(`Selected Claude model type: ${modelType} -> ${this._model}`);

		this._client = null;

		if (this._apiKey) {
			this._client = new Anthropic({
				apiKey: this._apiKey
			});
		}
	}

	/**
	 * Make a charging decision based on all available data
	 * @param {Object} context - All relevant data for decision making
	 * @returns {Promise<Object>} Decision object with recommendation and reasoning
	 */
	async makeChargingDecision(context) {
		if (!this._client) {
			throw new Error('Claude AI client not initialized - check API key');
		}

		try {
			const prompt = this._buildDecisionPrompt(context);

			this._adapter.log.info('🤖 Sending data to Claude AI for charging decision...');
			this._adapter.log.debug(`Using model: ${this._model}`);

			const startTime = Date.now();
			const message = await this._client.messages.create({
				model: this._model,
				max_tokens: 1024,
				messages: [{
					role: 'user',
					content: prompt
				}]
			});
			const duration = Date.now() - startTime;

			this._adapter.log.info(`✅ Claude AI response received (${duration}ms, ${message.usage.input_tokens} input tokens, ${message.usage.output_tokens} output tokens)`);
			// Extract text from content blocks (handle new SDK structure)
			const textContent = message.content.find(block => block.type === 'text');
			if (!textContent || textContent.type !== 'text') {
				throw new Error('No text content in Claude AI response');
			}
			this._adapter.log.debug(`AI Response: ${textContent.text.substring(0, 200)}...`);

			const response = textContent.text;
			return this._parseDecisionResponse(response);
		} catch (error) {
			this._adapter.log.error(`❌ Claude AI decision failed: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Test Claude AI connection
	 * @returns {Promise<Object>} Test result
	 */
	async testConnection() {
		if (!this._client) {
			return {
				success: false,
				message: 'Claude AI client not initialized - check API key'
			};
		}

		try {
			this._adapter.log.info('🧪 Testing Claude AI connection...');

			const startTime = Date.now();
			const message = await this._client.messages.create({
				model: this._model,
				max_tokens: 50,
				messages: [{
					role: 'user',
					content: 'Please respond with "Connection successful" if you receive this message.'
				}]
			});
			const duration = Date.now() - startTime;

			this._adapter.log.info(`✅ Claude AI connection test successful (${duration}ms)`);

			// Extract text from content blocks (handle new SDK structure)
			const textContent = message.content.find(block => block.type === 'text');
			const responseText = textContent && textContent.type === 'text' ? textContent.text : 'No text response';

			return {
				success: true,
				message: `Connection successful! Model: ${this._model}, Response time: ${duration}ms`,
				model: this._model,
				responseTime: duration,
				response: responseText
			};
		} catch (error) {
			this._adapter.log.error(`❌ Claude AI connection test failed: ${error.message}`);
			return {
				success: false,
				message: `Connection failed: ${error.message}`,
				error: error.message
			};
		}
	}

	/**
	 * Build the decision prompt for Claude
	 */
	_buildDecisionPrompt(context) {
		const consumptionSection = context.consumptionAnalysis
			? `\nHISTORICAL CONSUMPTION PATTERNS (last 7 days):
${this._formatConsumptionAnalysis(context.consumptionAnalysis)}
`
			: '';

		const pricingSection = context.pricingTimeslots && context.pricingTimeslots.length > 0
			? `\nOCTOPUS TIME-OF-USE TARIFF:
${context.pricingTimeslots.map(t =>
	`- ${t.name}: ${t.grossRate} ct/kWh (active ${t.activeFrom}–${t.activeTo})`
).join('\n')}
`
			: '';

		return `You are an energy management AI assistant. Your task is to decide how much to charge a home battery from the grid during cheap electricity phases.

CURRENT SITUATION:
- Current battery SOC: ${context.currentBatterySoc}%
- Battery capacity: ${context.batteryCapacity} kWh
- Minimum SOC allowed: ${context.batteryMinSoc}%
- Maximum charge power: ${context.batteryMaxChargePower} kW

CURRENT CONSUMPTION:
- Home power: ${context.currentHomePower} W
- PV power: ${context.currentPvPower} W
- Grid power: ${context.currentGridPower} W
${pricingSection}${consumptionSection}
SCHEDULED CHEAP CHARGING PHASES (next 24h from Octopus dispatch):
${context.cheapPhases.length > 0
	? context.cheapPhases.map(phase =>
		`- ${phase.start} to ${phase.end}: ${phase.deltaKwh} kWh planned`
	).join('\n')
	: 'No specific dispatch sessions scheduled (use tariff timeslots above for cheap windows)'}

PV PRODUCTION FORECAST (next 24h):
${this._summarizePvForecast(context.pvForecast)}

WEATHER FORECAST (next 24h):
${this._summarizeWeatherForecast(context.weatherForecast)}

DECISION CRITERIA:
1. Use the ToU tariff to identify cheap charging windows (low ct/kWh timeslots)
2. Calculate energy needed from battery between cheap phase end and when PV covers consumption
3. If PV forecast is good (sunny), a lower targetSoc may suffice; poor forecast → charge more
4. Use historical consumption to estimate gap energy demand and peak discharge hours
5. Consider weekday vs weekend consumption patterns for tomorrow
6. targetSoc must cover: minimum SOC + estimated gap consumption until PV is sufficient
7. Ensure battery never drops below minimum SOC

Please provide your decision in the following JSON format:
{
  "shouldCharge": true/false,
  "reason": "Brief explanation referencing tariff rates, PV forecast, and consumption data",
  "confidence": 0-100,
  "targetSoc": 0-100,
  "estimatedChargingTime": "HH:MM"
}`;
	}

	/**
	 * Format consumption analysis for prompt (fallback if ConsumptionAnalyzer not available)
	 */
	_formatConsumptionAnalysis(analysis) {
		if (!analysis) return 'No consumption data available';

		const peakHoursList = analysis.hourly.peakHours
			.map(p => `${p.hour}:00 (${p.power.toFixed(0)}W)`)
			.join(', ');

		const lowHoursList = analysis.hourly.lowHours
			.map(l => `${l.hour}:00 (${l.power.toFixed(0)}W)`)
			.join(', ');

		return `Daily average consumption: ${analysis.overall.dailyConsumption.toFixed(2)} kWh
Average power: ${analysis.overall.averagePower.toFixed(0)}W
Peak consumption hours: ${peakHoursList}
Low consumption hours: ${lowHoursList}
Weekday average: ${analysis.weekly.weekdayAverage.toFixed(0)}W
Weekend average: ${analysis.weekly.weekendAverage.toFixed(0)}W
Patterns: ${analysis.patterns.join(', ')}
${analysis.note ? `Note: ${analysis.note}` : ''}`;
	}

	/**
	 * Summarize PV forecast for the prompt
	 */
	_summarizePvForecast(pvForecast) {
		if (!pvForecast || pvForecast.length === 0) {
			return 'No PV forecast available';
		}

		const dailyTotal = pvForecast.reduce((sum, hour) => sum + hour.estimatedKwh, 0);
		const peakHour = pvForecast.reduce((max, hour) =>
			hour.estimatedKwh > max.estimatedKwh ? hour : max
		);

		return `Total expected production: ${dailyTotal.toFixed(2)} kWh
Peak production: ${peakHour.estimatedKwh.toFixed(2)} kWh at ${peakHour.timestamp.getHours()}:00
Average cloud coverage: ${(pvForecast.reduce((sum, h) => sum + h.cloudCoverage, 0) / pvForecast.length).toFixed(0)}%`;
	}

	/**
	 * Summarize weather forecast for the prompt
	 */
	_summarizeWeatherForecast(weatherForecast) {
		if (!weatherForecast || weatherForecast.length === 0) {
			return 'No weather forecast available';
		}

		const avgCloud = weatherForecast.reduce((sum, h) => sum + h.cloudCoverage, 0) / weatherForecast.length;
		const totalPrecip = weatherForecast.reduce((sum, h) => sum + (h.precipitation || 0), 0);
		const avgTemp = weatherForecast.reduce((sum, h) => sum + h.temperature, 0) / weatherForecast.length;

		// Calculate average solar irradiation if available (from DWD brightsky data)
		const solarData = weatherForecast.filter(h => h.solarIrradiation !== null && h.solarIrradiation !== undefined);
		const avgSolar = solarData.length > 0
			? solarData.reduce((sum, h) => sum + h.solarIrradiation, 0) / solarData.length
			: null;
		const totalSolar = solarData.length > 0
			? solarData.reduce((sum, h) => sum + h.solarIrradiation, 0)
			: null;

		// Calculate sunshine duration if available
		const sunshineData = weatherForecast.filter(h => h.sunshineDuration !== null && h.sunshineDuration !== undefined);
		const totalSunshine = sunshineData.length > 0
			? sunshineData.reduce((sum, h) => sum + h.sunshineDuration, 0)
			: null;

		let condition = 'mostly sunny';
		if (avgCloud > 70) condition = 'mostly cloudy';
		else if (avgCloud > 40) condition = 'partly cloudy';

		let summary = `Condition: ${condition} (${avgCloud.toFixed(0)}% cloud coverage)
Temperature: ${avgTemp.toFixed(1)}°C average
Precipitation: ${totalPrecip.toFixed(1)} mm total`;

		// Add solar data if available (critical for PV production forecasting)
		if (avgSolar !== null) {
			summary += `\nSolar irradiation: ${avgSolar.toFixed(3)} kWh/m² average, ${totalSolar.toFixed(2)} kWh/m² total`;
		}
		if (totalSunshine !== null) {
			summary += `\nSunshine duration: ${(totalSunshine / 60).toFixed(1)} hours total (${(totalSunshine / 60 / weatherForecast.length).toFixed(1)} hours/day avg)`;
		}

		return summary;
	}

	/**
	 * Parse the decision response from Claude
	 */
	_parseDecisionResponse(response) {
		try {
			// Try to extract JSON from the response
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const decision = JSON.parse(jsonMatch[0]);
				return {
					shouldCharge: decision.shouldCharge || false,
					reason: decision.reason || 'No reason provided',
					confidence: decision.confidence || 50,
					targetSoc: decision.targetSoc || 80,
					estimatedChargingTime: decision.estimatedChargingTime || '00:00',
					rawResponse: response
				};
			}

			// Fallback if no JSON found
			this._adapter.log.warn('Could not parse JSON from Claude response, using fallback');
			return {
				shouldCharge: false,
				reason: 'Failed to parse AI response',
				confidence: 0,
				targetSoc: 80,
				estimatedChargingTime: '00:00',
				rawResponse: response
			};
		} catch (error) {
			this._adapter.log.error(`Error parsing Claude response: ${error.message}`);
			throw error;
		}
	}
}

/**
 * Consumption Analyzer - Analyzes historical consumption data from History Adapter
 */
class ConsumptionAnalyzer {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._config = config;
		this._historyInstance = config.historyInstance || 'sql.0';
		this._evccPowerState = config.evccPowerState || 'evcc.0.status.homePower';
		this._evccPvPowerState = config.evccPvPowerState || 'evcc.0.status.pv';
		this._pvConservatismFactor = parseFloat(config.pvConservatismFactor) || 0.75;
	}

	/**
	 * Query a single state from the history adapter
	 * @param {string} stateId - ioBroker state ID
	 * @param {number} days - Number of days to fetch
	 * @returns {Promise<Array>} Raw history data points
	 */
	async _queryHistory(stateId, days) {
		const end = new Date();
		const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
		this._adapter.log.debug(`Fetching ${days} days of history for ${stateId} from ${this._historyInstance}`);
		return new Promise((resolve, reject) => {
			this._adapter.sendTo(this._historyInstance, 'getHistory', {
				id: stateId,
				options: { start: start.getTime(), end: end.getTime(), aggregate: 'average', step: 900000 }
			}, (result) => {
				if (result.error) {
					reject(new Error(result.error));
				} else {
					resolve(result.result || []);
				}
			});
		});
	}

	/**
	 * Get historical consumption data
	 * @param {number} days - Number of days to fetch
	 * @returns {Promise<Array>} Historical data points
	 */
	async getHistoricalData(days = 7) {
		try {
			return await this._queryHistory(this._evccPowerState, days);
		} catch (error) {
			this._adapter.log.error(`Error fetching consumption history: ${error.message}`);
			return [];
		}
	}

	/**
	 * Get historical PV production data from SQL
	 * @param {number} days - Number of days to fetch
	 * @returns {Promise<Array>} Historical data points
	 */
	async getHistoricalPvData(days = 7) {
		try {
			const data = await this._queryHistory(this._evccPvPowerState, days);
			this._adapter.log.debug(`Fetched ${data.length} historical PV data points from ${this._evccPvPowerState}`);
			return data;
		} catch (error) {
			this._adapter.log.warn(`Error fetching PV history (${this._evccPvPowerState}): ${error.message}`);
			return [];
		}
	}

	/**
	 * Analyze consumption patterns
	 * @returns {Promise<Object>} Consumption analysis
	 */
	async analyzeConsumption() {
		try {
			const [historicalData, pvData] = await Promise.all([
				this.getHistoricalData(7),
				this.getHistoricalPvData(7)
			]);

			if (!historicalData || historicalData.length === 0) {
				this._adapter.log.warn('No historical data available for analysis');
				return this._getDefaultAnalysis();
			}

			// Group data by hour and weekday
			const hourlyAverage = new Array(24).fill(0);
			const hourlyCount = new Array(24).fill(0);
			const weekdayAverage = new Array(7).fill(0);
			const weekdayCount = new Array(7).fill(0);
			const hourlyByWeekday = {};

			let totalConsumption = 0;
			let dataPoints = 0;

			historicalData.forEach(point => {
				if (point.val !== null && point.val !== undefined) {
					const date = new Date(point.ts);
					const hour = date.getHours();
					const weekday = date.getDay(); // 0 = Sunday, 6 = Saturday
					const value = Math.abs(point.val); // Use absolute value (positive for consumption)

					// Hourly average
					hourlyAverage[hour] += value;
					hourlyCount[hour]++;

					// Weekday average
					weekdayAverage[weekday] += value;
					weekdayCount[weekday]++;

					// Hourly by weekday
					const key = `${weekday}-${hour}`;
					if (!hourlyByWeekday[key]) {
						hourlyByWeekday[key] = { sum: 0, count: 0 };
					}
					hourlyByWeekday[key].sum += value;
					hourlyByWeekday[key].count++;

					totalConsumption += value;
					dataPoints++;
				}
			});

			// Calculate averages
			for (let i = 0; i < 24; i++) {
				if (hourlyCount[i] > 0) {
					hourlyAverage[i] = hourlyAverage[i] / hourlyCount[i];
				}
			}

			for (let i = 0; i < 7; i++) {
				if (weekdayCount[i] > 0) {
					weekdayAverage[i] = weekdayAverage[i] / weekdayCount[i];
				}
			}

			const overallAverage = dataPoints > 0 ? totalConsumption / dataPoints : 0;

			// Calculate daily consumption
			const dailyConsumption = overallAverage * 24;

			// Compute historical PV average per hour (W → kWh, with conservatism factor)
			const hourlyPvSumW = new Array(24).fill(0);
			const hourlyPvCountArr = new Array(24).fill(0);
			if (pvData && pvData.length > 0) {
				pvData.forEach(point => {
					if (point.val !== null && point.val !== undefined) {
						const hour = new Date(point.ts).getHours();
						hourlyPvSumW[hour] += Math.max(0, point.val);
						hourlyPvCountArr[hour]++;
					}
				});
			}
			// Average W per hour, then convert to kWh and apply conservatism
			const hourlyPvAverageKwh = hourlyPvSumW.map((sum, h) =>
				hourlyPvCountArr[h] > 0
					? (sum / hourlyPvCountArr[h] / 1000) * this._pvConservatismFactor
					: 0
			);
			const totalHistoricalPvKwh = hourlyPvAverageKwh.reduce((s, v) => s + v, 0);
			if (pvData.length > 0) {
				this._adapter.log.info(
					`ConsumptionAnalyzer: Historical PV avg ${totalHistoricalPvKwh.toFixed(1)} kWh/day ` +
					`(${this._pvConservatismFactor * 100}% conservatism, ${pvData.length} data points)`
				);
			}

			// Find peak hours
			const peakHours = [];
			for (let i = 0; i < 24; i++) {
				if (hourlyAverage[i] > overallAverage * 1.3) {
					peakHours.push({ hour: i, power: hourlyAverage[i] });
				}
			}
			peakHours.sort((a, b) => b.power - a.power);

			// Find low consumption hours
			const lowHours = [];
			for (let i = 0; i < 24; i++) {
				if (hourlyAverage[i] < overallAverage * 0.7 && hourlyAverage[i] > 0) {
					lowHours.push({ hour: i, power: hourlyAverage[i] });
				}
			}
			lowHours.sort((a, b) => a.power - b.power);

			// Weekday vs Weekend comparison
			const weekdayAvg = (weekdayAverage[1] + weekdayAverage[2] + weekdayAverage[3] +
							   weekdayAverage[4] + weekdayAverage[5]) / 5;
			const weekendAvg = (weekdayAverage[0] + weekdayAverage[6]) / 2;

			const analysis = {
				overall: {
					averagePower: overallAverage,
					dailyConsumption: dailyConsumption,
					dataPoints: dataPoints,
					daysAnalyzed: 7
				},
				hourly: {
					averageByHour: hourlyAverage,
					peakHours: peakHours.slice(0, 3),
					lowHours: lowHours.slice(0, 3)
				},
				weekly: {
					averageByWeekday: weekdayAverage,
					weekdayAverage: weekdayAvg,
					weekendAverage: weekendAvg,
					weekdayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
				},
				patterns: this._identifyPatterns(hourlyAverage, weekdayAverage),
				hourlyPvAverageKwh: hourlyPvAverageKwh // historical PV per hour (kWh, conservatism applied)
			};

			this._adapter.log.debug(`Consumption analysis complete: ${dailyConsumption.toFixed(2)} kWh/day average`);

			return analysis;
		} catch (error) {
			this._adapter.log.error(`Error analyzing consumption: ${error.message}`);
			return this._getDefaultAnalysis();
		}
	}

	/**
	 * Identify consumption patterns
	 */
	_identifyPatterns(hourlyAverage, weekdayAverage) {
		const patterns = [];

		// Morning peak detection (6-9 AM)
		const morningAvg = (hourlyAverage[6] + hourlyAverage[7] + hourlyAverage[8]) / 3;
		const overallAvg = hourlyAverage.reduce((sum, val) => sum + val, 0) / 24;

		if (morningAvg > overallAvg * 1.2) {
			patterns.push('morning_peak');
		}

		// Evening peak detection (18-22)
		const eveningAvg = (hourlyAverage[18] + hourlyAverage[19] + hourlyAverage[20] + hourlyAverage[21]) / 4;
		if (eveningAvg > overallAvg * 1.3) {
			patterns.push('evening_peak');
		}

		// Night consumption (22-6)
		const nightAvg = (hourlyAverage[22] + hourlyAverage[23] + hourlyAverage[0] +
						 hourlyAverage[1] + hourlyAverage[2] + hourlyAverage[3] +
						 hourlyAverage[4] + hourlyAverage[5]) / 8;
		if (nightAvg > overallAvg * 0.8) {
			patterns.push('high_night_consumption');
		} else {
			patterns.push('low_night_consumption');
		}

		// Weekday vs weekend
		const weekdayAvg = (weekdayAverage[1] + weekdayAverage[2] + weekdayAverage[3] +
						   weekdayAverage[4] + weekdayAverage[5]) / 5;
		const weekendAvg = (weekdayAverage[0] + weekdayAverage[6]) / 2;

		if (weekendAvg > weekdayAvg * 1.2) {
			patterns.push('higher_weekend_usage');
		} else if (weekdayAvg > weekendAvg * 1.2) {
			patterns.push('higher_weekday_usage');
		}

		return patterns;
	}

	/**
	 * Get default analysis when no historical data available
	 */
	_getDefaultAnalysis() {
		return {
			overall: {
				averagePower: 500, // 500W default
				dailyConsumption: 12, // 12 kWh/day default
				dataPoints: 0,
				daysAnalyzed: 0
			},
			hourly: {
				averageByHour: new Array(24).fill(500),
				peakHours: [
					{ hour: 7, power: 800 },
					{ hour: 19, power: 1000 },
					{ hour: 20, power: 900 }
				],
				lowHours: [
					{ hour: 3, power: 200 },
					{ hour: 4, power: 200 },
					{ hour: 14, power: 400 }
				]
			},
			weekly: {
				averageByWeekday: new Array(7).fill(500),
				weekdayAverage: 500,
				weekendAverage: 500,
				weekdayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
			},
			patterns: ['default_pattern'],
			note: 'Using default values - no historical data available',
			hourlyPvAverageKwh: new Array(24).fill(0)
		};
	}

	/**
	 * Format consumption analysis for AI prompt
	 */
	formatForPrompt(analysis) {
		const peakHoursList = analysis.hourly.peakHours
			.map(p => `${p.hour}:00 (${p.power.toFixed(0)}W)`)
			.join(', ');

		const lowHoursList = analysis.hourly.lowHours
			.map(l => `${l.hour}:00 (${l.power.toFixed(0)}W)`)
			.join(', ');

		return `Daily average consumption: ${analysis.overall.dailyConsumption.toFixed(2)} kWh
Average power: ${analysis.overall.averagePower.toFixed(0)}W
Peak consumption hours: ${peakHoursList}
Low consumption hours: ${lowHoursList}
Weekday average: ${analysis.weekly.weekdayAverage.toFixed(0)}W
Weekend average: ${analysis.weekly.weekendAverage.toFixed(0)}W
Patterns: ${analysis.patterns.join(', ')}
${analysis.note ? `Note: ${analysis.note}` : ''}`;
	}
}

/**
 * AI Decision Engine - Orchestrates all components to make charging decisions
 */
class AIDecisionEngine {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._config = config;

		this._weatherService = new WeatherService(adapter, config);
		this._pvForecast = new PVForecast(adapter, config);
		this._evccClient = new EVCCAdapter(adapter, config);
		this._claudeAI = new ClaudeAI(adapter, config);
		this._consumptionAnalyzer = new ConsumptionAnalyzer(adapter, config);

		this._decisionInterval = null;
	}

	/**
	 * Initialize the AI engine
	 */
	async initialize() {
		try {
			this._adapter.log.info('Initializing AI Decision Engine');

			// Connect to evcc adapter (reads from ioBroker states, not MQTT)
			await this._evccClient.connect();

			// Schedule daily decision making
			this._scheduleDecision();

			this._adapter.log.info('AI Decision Engine initialized successfully');
			return true;
		} catch (error) {
			this._adapter.log.error(`AI Engine initialization failed: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Schedule multiple decision times throughout the day
	 * Uses brightsky's 13h rolling forecast window for optimal decisions
	 */
	_scheduleDecision() {
		// Get decision times from config (comma-separated, e.g., "06:00,14:00,17:30,22:00")
		const defaultTimes = '06:00,17:30'; // Morning and main evening decision
		const timesStr = this._config.aiDecisionTimes || this._config.aiDecisionTime || defaultTimes;
		const decisionTimes = timesStr.split(',').map(t => t.trim());

		this._adapter.log.info(`AI Mode: Scheduling ${decisionTimes.length} decision times per day: ${decisionTimes.join(', ')}`);

		// Schedule each decision time
		this._decisionTimeouts = [];
		decisionTimes.forEach(timeStr => {
			this._scheduleNextDecisionAt(timeStr);
		});
	}

	/**
	 * Schedule next decision at specific time
	 */
	_scheduleNextDecisionAt(timeStr) {
		const [hours, minutes] = timeStr.split(':').map(Number);

		// Calculate next occurrence of this time
		const now = new Date();
		const next = new Date();
		next.setHours(hours, minutes, 0, 0);

		// If time has passed today, schedule for tomorrow
		if (next <= now) {
			next.setDate(next.getDate() + 1);
		}

		const msUntil = next.getTime() - now.getTime();

		this._adapter.log.info(`  → Next decision at ${timeStr}: ${next.toLocaleString()} (in ${Math.round(msUntil / 60000)} minutes)`);

		// Schedule the decision
		const timeout = setTimeout(() => {
			this._adapter.log.info(`🤖 Triggering scheduled AI decision (${timeStr})`);
			this.makeDecision().catch(error => {
				this._adapter.log.error(`AI decision failed: ${error.message}`);
			});
			// Reschedule for next day (24h later)
			this._scheduleNextDecisionAt(timeStr);
		}, msUntil);

		if (this._decisionTimeouts) {
			this._decisionTimeouts.push(timeout);
		}
	}

	/**
	 * Make a charging decision
	 */
	async makeDecision() {
		try {
			this._adapter.log.info('Starting AI charging decision process');

			// Gather all required data
			const context = await this._gatherDecisionContext();

			// Validate critical data
			this._adapter.log.debug(`Context validation: batterySoc=${context.currentBatterySoc}, homePower=${context.currentHomePower}, cheapPhases=${context.cheapPhases.length}`);

			// Make decision using Claude AI
			const decision = await this._claudeAI.makeChargingDecision(context);

			// Store decision in adapter states
			await this._storeDecision(decision);

			this._adapter.log.info(`AI Decision: ${decision.shouldCharge ? 'CHARGE' : 'DO NOT CHARGE'} - ${decision.reason}`);

			return decision;
		} catch (error) {
			this._adapter.log.error(`AI decision process failed: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Gather all context data needed for decision making
	 */
	async _gatherDecisionContext() {
		// Get weather forecast (brightsky provides 13h rolling window)
		const weatherForecast = await this._weatherService.getForecast();

		// Calculate PV production forecast
		const pvForecast = this._pvForecast.calculateProduction(weatherForecast);

		// Get current evcc data
		const evccData = await this._evccClient.getData();

		// Get cheap phases from adapter states (planned dispatches)
		const cheapPhases = await this._getCheapPhases();

		// Get Octopus ToU pricing timeslots (actual tariff structure)
		const pricingTimeslots = await this._getPricingTimeslots();

		// Analyze historical consumption patterns
		let consumptionAnalysis = null;
		if (this._config.enableHistoryAnalysis !== false) {
			try {
				consumptionAnalysis = await this._consumptionAnalyzer.analyzeConsumption();
			} catch (error) {
				this._adapter.log.warn(`Could not analyze consumption history: ${error.message}`);
			}
		}

		return {
			currentBatterySoc: evccData.batterySoc,
			batteryCapacity: this._config.batteryCapacity,
			batteryMinSoc: this._config.batteryMinSoc,
			batteryMaxChargePower: parseFloat(this._config.acChargePowerKw) || 4.0,
			currentHomePower: evccData.homePower,
			currentPvPower: evccData.pvPower,
			currentGridPower: evccData.gridPower,
			cheapPhases: cheapPhases,
			pricingTimeslots: pricingTimeslots,
			pvForecast: pvForecast,
			weatherForecast: weatherForecast,
			consumptionAnalysis: consumptionAnalysis,
			timestamp: new Date().toISOString()
		};
	}

	/**
	 * Read Octopus ToU pricing timeslots from ioBroker states.
	 * Provides Claude with actual tariff structure instead of only plannedDispatches.
	 */
	async _getPricingTimeslots() {
		const timeslots = [];
		try {
			for (let i = 0; i < 4; i++) {
				const rateState = await this._adapter.getStateAsync(
					`pricing.malo_0_agreement_0.timeslot_${i}.grossRate`
				);
				if (!rateState || rateState.val === null) break;

				const nameState = await this._adapter.getStateAsync(
					`pricing.malo_0_agreement_0.timeslot_${i}.name`
				);
				const fromState = await this._adapter.getStateAsync(
					`pricing.malo_0_agreement_0.timeslot_${i}.activeFrom_0`
				);
				const toState = await this._adapter.getStateAsync(
					`pricing.malo_0_agreement_0.timeslot_${i}.activeTo_0`
				);

				timeslots.push({
					name:      nameState?.val  || `Timeslot ${i}`,
					grossRate: rateState.val,
					activeFrom: fromState?.val || '?',
					activeTo:   toState?.val   || '?'
				});
			}
		} catch (error) {
			this._adapter.log.warn(`Could not read pricing timeslots: ${error.message}`);
		}
		return timeslots;
	}

	/**
	 * Get cheap electricity phases from adapter states
	 */
	async _getCheapPhases() {
		try {
			// Read plannedDispatches from adapter state (stored by main adapter)
			const state = await this._adapter.getStateAsync('plannedDispatches');
			if (!state || !state.val) {
				this._adapter.log.debug('No plannedDispatches available');
				return [];
			}

			const dispatches = JSON.parse(state.val);
			const now = new Date();
			const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Next 24 hours

			return dispatches
				.filter(d => {
					const start = new Date(d.startDt);
					return start >= now && start <= cutoff;
				})
				.map(d => ({
					start: d.startDt,
					end: d.endDt,
					deltaKwh: d.delta.kwh
				}));
		} catch (error) {
			this._adapter.log.error(`Error reading cheap phases: ${error.message}`);
			return [];
		}
	}

	/**
	 * Store decision in adapter states
	 */
	async _storeDecision(decision) {
		const basePath = 'aiMode.recommendation';

		await this._adapter.setObjectNotExistsAsync(`${basePath}.shouldCharge`, {
			type: 'state',
			common: {
				name: 'AI Recommendation: Should Charge',
				type: 'boolean',
				role: 'indicator',
				read: true,
				write: false
			},
			native: {}
		});

		await this._adapter.setObjectNotExistsAsync(`${basePath}.reason`, {
			type: 'state',
			common: {
				name: 'AI Recommendation: Reason',
				type: 'string',
				role: 'text',
				read: true,
				write: false
			},
			native: {}
		});

		await this._adapter.setObjectNotExistsAsync(`${basePath}.confidence`, {
			type: 'state',
			common: {
				name: 'AI Recommendation: Confidence',
				type: 'number',
				role: 'value',
				unit: '%',
				read: true,
				write: false
			},
			native: {}
		});

		await this._adapter.setObjectNotExistsAsync(`${basePath}.targetSoc`, {
			type: 'state',
			common: {
				name: 'AI Recommendation: Target SOC',
				type: 'number',
				role: 'value',
				unit: '%',
				read: true,
				write: false
			},
			native: {}
		});

		await this._adapter.setObjectNotExistsAsync('aiMode.lastDecision', {
			type: 'state',
			common: {
				name: 'Last AI Decision Time',
				type: 'string',
				role: 'value.datetime',
				read: true,
				write: false
			},
			native: {}
		});

		// Set the values
		await this._adapter.setStateAsync(`${basePath}.shouldCharge`, decision.shouldCharge, true);
		await this._adapter.setStateAsync(`${basePath}.reason`, decision.reason, true);
		await this._adapter.setStateAsync(`${basePath}.confidence`, decision.confidence, true);
		await this._adapter.setStateAsync(`${basePath}.targetSoc`, decision.targetSoc, true);
		await this._adapter.setStateAsync('aiMode.lastDecision', new Date().toISOString(), true);
	}

	/**
	 * Shutdown the AI engine
	 */
	async shutdown() {
		this._adapter.log.info('Shutting down AI Decision Engine');

		// Clear all scheduled decision timeouts
		if (this._decisionTimeouts && this._decisionTimeouts.length > 0) {
			this._adapter.log.info(`Clearing ${this._decisionTimeouts.length} scheduled decision timeouts`);
			this._decisionTimeouts.forEach(timeout => clearTimeout(timeout));
			this._decisionTimeouts = [];
		}

		// Legacy cleanup (if old code still running)
		if (this._decisionInterval) {
			clearInterval(this._decisionInterval);
			this._decisionInterval = null;
		}

		this._evccClient.disconnect();
	}
}

/**
 * Smart Charging Planner - Calculates optimal battery charge target based on PV forecast and pricing
 * Works without Claude AI (purely algorithmic). Uses cheap phase times from pricing states and
 * brightsky weather data to determine how much the battery needs to be charged during cheap phases
 * so it lasts until solar production is sufficient.
 */
class SmartChargingPlanner {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._config = config;
		this._batteryCapacity = parseFloat(config.batteryCapacity) || 10;
		this._batteryMinSoc = parseFloat(config.batteryMinSoc) || 20;
		this._acChargePower = parseFloat(config.acChargePowerKw) || 4.0;
		this._householdConsumptionKw = parseFloat(config.householdConsumptionKw) || 0.5;
		this._pvSufficiencyThreshold = parseFloat(config.pvSufficiencyThreshold) || 1.0;
		this._evccUrl = (config.evccUrl || 'http://evcc:7070').replace(/\/$/, '');

		this._dailyTimer = null;
		this._controlInterval = null;

		// Cached values from last calculate() — used by the control loop
		this._cachedCheapPhase = null;
		this._cachedTargetSoc = null;
		// Tracks whether we currently have grid charging enabled in evcc.
		// null = unknown (adapter just started, evcc state unsynced) → forces first cycle to always write
		this._gridChargingActive = null;

		this._weatherService = new WeatherService(adapter, config);
		this._pvForecast = new PVForecast(adapter, config);
		this._consumptionAnalyzer = new ConsumptionAnalyzer(adapter, config);
	}

	async initialize() {
		await this._createStates();
		this._scheduleNextCalculation();
		await this.calculate();
		this._startControlLoop();
	}

	async _createStates() {
		await this._adapter.setObjectNotExistsAsync('smartCharging', {
			type: 'channel',
			common: { name: 'Smart Charging Plan' },
			native: {}
		});

		const stateDefinitions = {
			'targetSoc':            { name: 'Battery Target SoC (%)',           type: 'number',  role: 'value',                  unit: '%',   def: 0     },
			'cheapPhaseEnd':        { name: 'End of Cheap Electricity Phase',   type: 'string',  role: 'value.datetime',         unit: null,  def: ''    },
			'solarSufficiencyTime': { name: 'Estimated Solar Sufficiency Time', type: 'string',  role: 'value.datetime',         unit: null,  def: ''    },
			'energyGapKwh':         { name: 'Energy Gap to Bridge (kWh)',       type: 'number',  role: 'value.power.consumption',unit: 'kWh', def: 0     },
			'estimatedPvKwh':       { name: 'Estimated PV Production (kWh)',    type: 'number',  role: 'value.power.consumption',unit: 'kWh', def: 0     },
			'recommendation':       { name: 'Recommendation',                   type: 'string',  role: 'text',                   unit: null,  def: ''    },
			'lastCalculation':      { name: 'Last Calculation',                 type: 'string',  role: 'value.datetime',         unit: null,  def: ''    },
			'chargingStartTime':          { name: 'Planned Charging Start Time',             type: 'string',  role: 'value.datetime',         unit: null,  def: ''    },
			'chargingDurationMin':        { name: 'Required Charging Duration (min)',        type: 'number',  role: 'value',                  unit: 'min', def: 0     },
			'projectedSocAtPhaseStart':   { name: 'Projected Battery SoC at Phase Start (%)',type: 'number', role: 'value.battery',          unit: '%',   def: 0     },
			'gridChargingActive':         { name: 'Grid Charging Active in evcc',            type: 'boolean', role: 'indicator',              unit: null,  def: false },
			'batterySoc':                 { name: 'Current Battery SoC (%)',                 type: 'number',  role: 'value.battery',          unit: '%',   def: 0     }
		};

		for (const [key, def] of Object.entries(stateDefinitions)) {
			await this._adapter.setObjectNotExistsAsync(`smartCharging.${key}`, {
				type: 'state',
				common: {
					name: def.name,
					type: def.type,
					role: def.role,
					read: true,
					write: false,
					...(def.unit ? { unit: def.unit } : {}),
					def: def.def
				},
				native: {}
			});
		}

		await this._adapter.setObjectNotExistsAsync('smartCharging.triggerCalculation', {
			type: 'state',
			common: {
				name: 'Trigger Calculation Now',
				type: 'boolean',
				role: 'button',
				read: true,
				write: true,
				def: false
			},
			native: {}
		});
	}

	/**
	 * Main calculation: read cheap phase from pricing states, get PV forecast,
	 * then compute required battery SoC to bridge the gap until solar sufficiency.
	 * Also updates the cached values used by the control loop.
	 */
	async calculate() {
		try {
			this._adapter.log.info('SmartChargingPlanner: Starting calculation...');

			// Step 1: Read cheap phase window from pricing states
			const cheapPhase = await this._getCheapPhaseFromPricing();
			if (!cheapPhase) {
				this._adapter.log.warn('SmartChargingPlanner: Pricing timeslot data not yet available - will retry at next poll cycle');
				return;
			}

			// Step 2: Fetch historical consumption data (falls back gracefully if unavailable)
			let consumptionAnalysis = null;
			try {
				const analysis = await this._consumptionAnalyzer.analyzeConsumption();
				if (analysis && analysis.overall.dataPoints > 0) {
					consumptionAnalysis = analysis;
					this._adapter.log.info(
						`SmartChargingPlanner: Using ${analysis.overall.dataPoints} historical data points ` +
						`(avg ${(analysis.overall.averagePower / 1000).toFixed(2)} kW)`
					);
				} else {
					this._adapter.log.info(
						`SmartChargingPlanner: No historical data available, using static fallback ` +
						`(${this._householdConsumptionKw} kW)`
					);
				}
			} catch (error) {
				this._adapter.log.warn(`SmartChargingPlanner: History query failed: ${error.message} — using static fallback`);
			}

			// Step 3: Get weather forecast from brightsky and calculate PV production
			const weatherForecast = await this._weatherService.getForecast();
			const pvProduction = this._pvForecast.calculateProduction(weatherForecast);

			// Step 4: Find when PV production first covers household consumption
			// Uses historical hourly averages if available, otherwise pvSufficiencyThreshold
			const solarSufficiencyHour = this._findSolarSufficiencyTime(pvProduction, cheapPhase.endHour, consumptionAnalysis);

			// Step 5: Calculate NET energy gap (consumption − PV) between cheap phase end and solar sufficiency
			// Battery only needs to cover the deficit that PV cannot supply during this period.
			const { energyGapKwh, dataSource } = this._calculateEnergyGap(cheapPhase.endHour, solarSufficiencyHour, consumptionAnalysis, pvProduction);

			// Step 6: Calculate required battery SoC
			const minBatteryKwh = this._batteryCapacity * this._batteryMinSoc / 100;
			const requiredKwh = minBatteryKwh + energyGapKwh;
			const targetSoc = Math.min(100, Math.ceil(requiredKwh / this._batteryCapacity * 100));

			// Step 7: Sum PV production during the gap period for info
			const gapPvKwh = pvProduction
				.filter(h => {
					const hourDecimal = h.timestamp.getHours() + h.timestamp.getMinutes() / 60;
					return hourDecimal >= cheapPhase.endHour && hourDecimal <= solarSufficiencyHour;
				})
				.reduce((sum, h) => sum + h.estimatedKwh, 0);

			const cheapPhaseEndStr = this._formatHour(cheapPhase.endHour);
			const solarSufficiencyStr = this._formatHour(solarSufficiencyHour);
			const energyGapHours = Math.max(0, solarSufficiencyHour - cheapPhase.endHour);

			// Step 8: Estimate charging start time based on projected SoC at cheap phase start
			const currentSoc = await this._getBatterySoc();
			const currentSocVal = currentSoc !== null ? currentSoc : 0;
			// Project SoC forward to cheap phase start: subtract expected consumption between now and phase start
			const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
			const projectedSocAtPhaseStart = this._projectSocToPhaseStart(currentSocVal, nowHour, cheapPhase.startHour, consumptionAnalysis);
			const socDeficit = Math.max(0, targetSoc - projectedSocAtPhaseStart);
			const chargingDurationH = socDeficit / 100 * this._batteryCapacity / this._acChargePower;
			const chargingDurationMin = Math.ceil(chargingDurationH * 60);
			// Charging starts "chargingDurationH" before phase end (wrap around midnight)
			const chargingStartHourRaw = cheapPhase.endHour - chargingDurationH;
			const chargingStartHour = ((chargingStartHourRaw % 24) + 24) % 24;
			const chargingStartStr = this._formatHour(chargingStartHour);

			const recommendation = energyGapHours > 0
				? `Charge battery to ${targetSoc}% during cheap phase (ends ${cheapPhaseEndStr}). ` +
				  `Solar covers consumption from ~${solarSufficiencyStr} ` +
				  `(gap: ${energyGapHours.toFixed(1)}h, ${energyGapKwh.toFixed(1)} kWh — ${dataSource}).`
				: `Solar is already sufficient when cheap phase ends at ${cheapPhaseEndStr}. ` +
				  `Minimum charge of ${this._batteryMinSoc}% is sufficient (${dataSource}).`;

			// Cache for control loop
			this._cachedCheapPhase = cheapPhase;
			this._cachedTargetSoc = targetSoc;

			// Update states
			await this._adapter.setStateAsync('smartCharging.targetSoc',            { val: targetSoc,                             ack: true });
			await this._adapter.setStateAsync('smartCharging.cheapPhaseEnd',         { val: cheapPhaseEndStr,                      ack: true });
			await this._adapter.setStateAsync('smartCharging.solarSufficiencyTime',  { val: solarSufficiencyStr,                   ack: true });
			await this._adapter.setStateAsync('smartCharging.energyGapKwh',          { val: Math.round(energyGapKwh * 100) / 100, ack: true });
			await this._adapter.setStateAsync('smartCharging.estimatedPvKwh',        { val: Math.round(gapPvKwh * 100) / 100,     ack: true });
			await this._adapter.setStateAsync('smartCharging.chargingStartTime',           { val: chargingStartStr,                              ack: true });
			await this._adapter.setStateAsync('smartCharging.chargingDurationMin',         { val: chargingDurationMin,                           ack: true });
			await this._adapter.setStateAsync('smartCharging.projectedSocAtPhaseStart',    { val: Math.round(projectedSocAtPhaseStart),           ack: true });
			await this._adapter.setStateAsync('smartCharging.recommendation',         { val: recommendation,                       ack: true });
			await this._adapter.setStateAsync('smartCharging.lastCalculation',        { val: new Date().toISOString(),             ack: true });

			this._adapter.log.info(
				`SmartChargingPlanner: Target SoC=${targetSoc}% | Charging ${chargingDurationMin} min ` +
				`starting ~${chargingStartStr} | ${recommendation}`
			);

			// Telegram notification
			if (this._config.enableSmartChargingNotification) {
				const totalPvKwh = pvProduction.reduce((s, h) => s + h.estimatedKwh, 0);
				const cheapPhaseStart = this._formatHour(cheapPhase.startHour);
				await this._sendTelegramMessage({
					cheapPhaseStart,
					cheapPhaseEnd: cheapPhaseEndStr,
					grossRate: cheapPhase.grossRate,
					targetSoc,
					currentSoc: Math.round(currentSocVal),
					projectedSoc: Math.round(projectedSocAtPhaseStart),
					chargingStartTime: chargingStartStr,
					chargingDurationMin,
					solarSufficiencyTime: solarSufficiencyStr,
					energyGapKwh,
					energyGapHours,
					gapPvKwh,
					totalPvKwh,
					dataSource,
				});
			}
		} catch (error) {
			this._adapter.log.error(`SmartChargingPlanner: Calculation failed: ${error.message}`);
			this._adapter.log.error(error.stack);
		}
	}

	/**
	 * Send a Telegram message with the daily Smart Charging plan summary.
	 */
	async _sendTelegramMessage({ cheapPhaseStart, cheapPhaseEnd, grossRate, targetSoc,
		currentSoc, projectedSoc, chargingStartTime, chargingDurationMin,
		solarSufficiencyTime, energyGapKwh, energyGapHours, gapPvKwh, totalPvKwh, dataSource }) {
		try {
			const instance  = this._config.telegramInstance || 'telegram.0';
			const user      = this._config.telegramUser || '';
			const dateStr   = new Date().toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

			const lines = [
				`🔋 *Calamari – Täglicher Ladeplan* (${dateStr})`,
				``,
				`⚡ *Günstige Phase:* ${cheapPhaseStart} – ${cheapPhaseEnd} (${grossRate} ct/kWh)`,
				``,
				`🔋 *Akku jetzt:* ${currentSoc}% → bei Ladestart (${cheapPhaseStart}): ${projectedSoc}% → *Ziel:* ${targetSoc}%`,
				`⏱ *Ladestart:* ${chargingStartTime} (${chargingDurationMin} min bei ${this._acChargePower} kW AC)`,
				``,
				`☀️ *PV ausreichend ab:* ${solarSufficiencyTime}`,
			];

			if (energyGapHours > 0) {
				lines.push(`⏳ *Energie-Lücke:* ${energyGapHours.toFixed(1)} h`);
				lines.push(`   Verbrauch netto: ${energyGapKwh.toFixed(1)} kWh (${dataSource})`);
				if (gapPvKwh > 0) {
					lines.push(`   PV in Lücke: ${gapPvKwh.toFixed(1)} kWh (bereits abgezogen)`);
				}
			} else {
				lines.push(`✅ Kein Energie-Gap – PV deckt Verbrauch direkt nach der günstigen Phase.`);
			}

			lines.push(``);
			lines.push(`🌤️ *PV-Vorhersage gesamt:* ${totalPvKwh.toFixed(1)} kWh`);
			lines.push(`💡 Ladestart automatisch um ${chargingStartTime}. Keine manuelle Aktion nötig.`);

			const text = lines.join('\n');
			const payload = user ? { text, user } : { text };

			await new Promise((resolve) => {
				this._adapter.sendTo(instance, 'send', payload, resolve);
			});
			this._adapter.log.info(`SmartChargingPlanner: Telegram notification sent to ${instance}`);
		} catch (error) {
			this._adapter.log.warn(`SmartChargingPlanner: Telegram send failed: ${error.message}`);
		}
	}

	// -------------------------------------------------------------------------
	// Battery Control Loop
	// -------------------------------------------------------------------------

	/**
	 * Start the 5-minute control loop that activates/deactivates grid charging in evcc.
	 */
	_startControlLoop() {
		// Run immediately, then every 5 minutes
		this._runControlCycle();
		this._controlInterval = setInterval(() => {
			this._runControlCycle();
		}, 5 * 60 * 1000);
		this._adapter.log.info('SmartChargingPlanner: Battery control loop started (every 5 min)');
	}

	/**
	 * Control cycle: just-in-time charging strategy.
	 *
	 * Instead of enabling charging at the start of the cheap phase, we calculate
	 * how long the battery needs to charge (based on current SoC, targetSoC, and
	 * AC charge power) and enable charging only when that exact window remains.
	 *
	 * Logic:
	 *   chargingDurationH = (targetSoC − currentSoC) / 100 * capacity / acChargePower
	 *   Enable charging when: in cheap phase AND hoursRemaining ≤ chargingDurationH AND SoC < targetSoC
	 *   Disable charging in all other cases.
	 */
	async _runControlCycle() {
		try {
			// Lazily fetch cheap phase if not yet cached (e.g., adapter just started)
			if (!this._cachedCheapPhase) {
				const cheapPhase = await this._getCheapPhaseFromPricing();
				if (!cheapPhase) return;
				this._cachedCheapPhase = cheapPhase;
			}
			if (this._cachedTargetSoc === null) return;

			const inCheapPhase = this._isCurrentlyInCheapPhase(this._cachedCheapPhase);
			const batterySoc = await this._getBatterySoc();

			if (batterySoc !== null) {
				await this._adapter.setStateAsync('smartCharging.batterySoc', { val: Math.round(batterySoc), ack: true });
			}

			// Just-in-time: how much time is left in the cheap phase right now?
			const now = new Date();
			const currentHour = now.getHours() + now.getMinutes() / 60;
			const hoursRemaining = inCheapPhase
				? this._hoursUntilCheapPhaseEnd(this._cachedCheapPhase, currentHour)
				: Infinity; // Not in phase → never start charging

			// How long does charging take from current SoC to targetSoC?
			const socDeficit = batterySoc !== null ? Math.max(0, this._cachedTargetSoc - batterySoc) : 0;
			const chargingDurationH = (socDeficit / 100) * this._batteryCapacity / this._acChargePower;

			// Enable charging when the remaining phase time ≤ required charging time
			const shouldCharge = inCheapPhase
				&& batterySoc !== null
				&& batterySoc < this._cachedTargetSoc
				&& hoursRemaining <= chargingDurationH;

			if (shouldCharge === this._gridChargingActive) return; // No change needed

			if (shouldCharge) {
				const success = await this._setEvccGridChargeLimit(true);
				if (success) {
					this._gridChargingActive = true;
					await this._adapter.setStateAsync('smartCharging.gridChargingActive', { val: true, ack: true });
					this._adapter.log.info(
						`SmartChargingPlanner: Grid charging ENABLED — just-in-time window ` +
						`(SoC ${batterySoc.toFixed(0)}% → target ${this._cachedTargetSoc}%, ` +
						`${(chargingDurationH * 60).toFixed(0)} min needed, ` +
						`${(hoursRemaining * 60).toFixed(0)} min remaining in cheap phase)`
					);
				}
			} else {
				const reason = !inCheapPhase
					? 'outside cheap phase'
					: batterySoc >= this._cachedTargetSoc
						? `SoC ${batterySoc.toFixed(0)}% >= target ${this._cachedTargetSoc}%`
						: `waiting — ${(hoursRemaining * 60).toFixed(0)} min remaining, ` +
						  `need ${(chargingDurationH * 60).toFixed(0)} min`;
				const success = await this._setEvccGridChargeLimit(false);
				if (success) {
					this._gridChargingActive = false;
					await this._adapter.setStateAsync('smartCharging.gridChargingActive', { val: false, ack: true });
					this._adapter.log.info(`SmartChargingPlanner: Grid charging DISABLED (${reason})`);
				}
			}
		} catch (error) {
			this._adapter.log.error(`SmartChargingPlanner: Control cycle error: ${error.message}`);
		}
	}

	/**
	 * Returns how many hours remain until the end of the cheap phase.
	 * Handles midnight-crossing phases (e.g., 22:00–06:00).
	 */
	_hoursUntilCheapPhaseEnd(cheapPhase, currentHour) {
		const { startHour, endHour } = cheapPhase;
		if (endHour <= startHour) {
			// Midnight-crossing (e.g., 22:00–06:00)
			if (currentHour >= startHour) {
				// Before midnight: e.g., 23:00 → end is 06:00 next day = (24-23)+6 = 7h
				return (24 - currentHour) + endHour;
			} else {
				// After midnight: e.g., 03:00 → end is 06:00 today = 3h
				return endHour - currentHour;
			}
		} else {
			// Same-day phase
			return endHour - currentHour;
		}
	}

	/**
	 * Check whether the current time falls within the cheap electricity phase.
	 * Handles phases that cross midnight (e.g., 22:00–06:00).
	 */
	_isCurrentlyInCheapPhase(cheapPhase) {
		const now = new Date();
		const currentHour = now.getHours() + now.getMinutes() / 60;

		if (cheapPhase.endHour <= cheapPhase.startHour) {
			// Crosses midnight (e.g., 22:00 – 06:00)
			return currentHour >= cheapPhase.startHour || currentHour < cheapPhase.endHour;
		} else {
			// Within same day (e.g., 08:00 – 12:00)
			return currentHour >= cheapPhase.startHour && currentHour < cheapPhase.endHour;
		}
	}

	/**
	 * Read current battery SoC from evcc ioBroker adapter states.
	 */
	async _getBatterySoc() {
		try {
			const socStatePath = this._config.evccBatterySocState || 'evcc.0.status.battery';
			const state = await this._adapter.getForeignStateAsync(socStatePath);
			if (!state || state.val === null) return null;

			// evcc stores battery data as JSON object: {"soc": 85, "power": 0, ...}
			if (typeof state.val === 'string') {
				try {
					const battery = JSON.parse(state.val);
					if (battery && typeof battery.soc === 'number') {
						this._adapter.log.debug(`SmartChargingPlanner: Battery SoC from JSON: ${battery.soc}%`);
						return battery.soc;
					}
				} catch (_) { /* not JSON, fall through */ }
			}
			// Plain numeric value (e.g. a direct SOC state)
			if (typeof state.val === 'number') return state.val;

			this._adapter.log.warn(`SmartChargingPlanner: Unexpected battery SoC format at ${socStatePath}: ${state.val}`);
			return null;
		} catch (error) {
			this._adapter.log.error(`SmartChargingPlanner: Error reading battery SoC: ${error.message}`);
			return null;
		}
	}

	/**
	 * Enable or disable battery grid charging in evcc via REST API.
	 *
	 * evcc endpoint: POST /api/batterygridchargelimit/<value>
	 *   value > 0  → enable grid charging when current price < value (we use 999 = "always")
	 *   value = 0  → disable grid charging entirely
	 *
	 * Note: requires "Experimentelle Funktionen" enabled in evcc UI.
	 */
	async _setEvccGridChargeLimit(enable) {
		// 999 €/kWh = always allow (any real price will be below this)
		const limitValue = enable ? 999 : 0;
		try {
			await axios.post(`${this._evccUrl}/api/batterygridchargelimit/${limitValue}`);
			this._adapter.log.debug(`SmartChargingPlanner: evcc batterygridchargelimit → ${limitValue}`);
			return true;
		} catch (error) {
			this._adapter.log.error(
				`SmartChargingPlanner: Failed to set evcc batterygridchargelimit to ${limitValue}: ${error.message}`
			);
			return false;
		}
	}

	// -------------------------------------------------------------------------
	// Shared helpers
	// -------------------------------------------------------------------------

	/**
	 * Project battery SoC from now to the cheap phase start time.
	 * Subtracts expected household consumption (from historical data) between nowHour and phaseStartHour.
	 * This ensures the energy deficit calculation accounts for drain before charging begins.
	 */
	_projectSocToPhaseStart(currentSoc, nowHour, phaseStartHour, consumptionAnalysis) {
		// Compute hours until phase start (handle midnight crossing)
		let hoursUntilStart = phaseStartHour - nowHour;
		if (hoursUntilStart < 0) hoursUntilStart += 24;
		if (hoursUntilStart <= 0) return currentSoc;

		let consumedKwh = 0;
		if (consumptionAnalysis && consumptionAnalysis.hourly && consumptionAnalysis.overall && consumptionAnalysis.overall.dataPoints > 0) {
			const endH = nowHour + hoursUntilStart;
			for (let h = Math.floor(nowHour); h < Math.ceil(endH); h++) {
				const hourIdx   = h % 24;
				const avgWatts  = consumptionAnalysis.hourly.averageByHour[hourIdx] || 0;
				const slotStart = Math.max(h, nowHour);
				const slotEnd   = Math.min(h + 1, endH);
				consumedKwh += (avgWatts / 1000) * (slotEnd - slotStart);
			}
		} else {
			const fallbackKw = parseFloat(this._config.householdConsumptionKw) || 0.5;
			consumedKwh = fallbackKw * hoursUntilStart;
		}

		const socDrop = (consumedKwh / this._batteryCapacity) * 100;
		const projected = Math.max(0, currentSoc - socDrop);
		this._adapter.log.debug(
			`SmartChargingPlanner: SoC projection: now=${currentSoc}% | drain until phase start=${consumedKwh.toFixed(2)} kWh (${socDrop.toFixed(1)}%) | projected=${projected.toFixed(1)}%`
		);
		return projected;
	}

	/**
	 * Calculate the NET energy the battery must provide during the gap (cheapPhaseEnd → solarSufficiency).
	 * Net = consumption − PV production per hour (battery only covers what PV can't).
	 * Uses historical hourly consumption when available, falls back to static config value.
	 * @param {number} startHour - Decimal hour when gap begins
	 * @param {number} endHour   - Decimal hour when PV covers consumption (gap ends)
	 * @param {object|null} consumptionAnalysis - Result from ConsumptionAnalyzer
	 * @param {Array}  pvProduction - Hourly PV forecast [{timestamp, estimatedKwh}, ...]
	 * @returns {{ energyGapKwh: number, dataSource: string }}
	 */
	_calculateEnergyGap(startHour, endHour, consumptionAnalysis, pvProduction) {
		const gapHours = Math.max(0, endHour - startHour);
		if (gapHours === 0) return { energyGapKwh: 0, dataSource: 'no gap' };

		const hasHistoricalPv = consumptionAnalysis && consumptionAnalysis.hourlyPvAverageKwh &&
			consumptionAnalysis.hourlyPvAverageKwh.some(v => v > 0);

		// Build hour → PV kWh lookup.
		// Priority: historical SQL data (already has conservatism applied) > brightsky forecast.
		const pvByHour = {};
		if (hasHistoricalPv) {
			consumptionAnalysis.hourlyPvAverageKwh.forEach((kwh, h) => { pvByHour[h] = kwh; });
			this._adapter.log.debug('SmartChargingPlanner: Using historical PV data for energy gap');
		} else if (pvProduction) {
			for (const slot of pvProduction) {
				pvByHour[slot.timestamp.getHours()] = (pvByHour[slot.timestamp.getHours()] || 0) + slot.estimatedKwh;
			}
			this._adapter.log.debug('SmartChargingPlanner: Using brightsky PV forecast for energy gap (no SQL history)');
		}

		const startInt = Math.floor(startHour);
		const endInt   = Math.ceil(endHour);

		if (consumptionAnalysis && consumptionAnalysis.hourly && consumptionAnalysis.overall.dataPoints > 0) {
			let totalKwh = 0;
			for (let h = startInt; h < endInt; h++) {
				const hourIdx    = h % 24;
				const avgWatts   = consumptionAnalysis.hourly.averageByHour[hourIdx] || 0;
				const slotStart  = Math.max(h, startHour);
				const slotEnd    = Math.min(h + 1, endHour);
				const fraction   = slotEnd - slotStart;
				const consumKwh  = (avgWatts / 1000) * fraction;
				const pvKwh      = (pvByHour[hourIdx] || 0) * fraction;
				totalKwh += Math.max(0, consumKwh - pvKwh);
			}
			const dataSource = hasHistoricalPv ? 'historical consumption + historical PV' : 'historical consumption + PV forecast';
			return { energyGapKwh: totalKwh, dataSource };
		}

		// Fallback: flat static consumption minus PV
		let totalKwh = 0;
		for (let h = startInt; h < endInt; h++) {
			const hourIdx    = h % 24;
			const slotStart  = Math.max(h, startHour);
			const slotEnd    = Math.min(h + 1, endHour);
			const fraction   = slotEnd - slotStart;
			const consumKwh  = this._householdConsumptionKw * fraction;
			const pvKwh      = (pvByHour[hourIdx] || 0) * fraction;
			totalKwh += Math.max(0, consumKwh - pvKwh);
		}
		const dataSource = hasHistoricalPv
			? `static fallback (${this._householdConsumptionKw} kW) + historical PV`
			: `static fallback (${this._householdConsumptionKw} kW) + PV forecast`;
		return { energyGapKwh: totalKwh, dataSource };
	}

	/**
	 * Find the first hour where PV production covers household consumption.
	 * Prefers historical SQL data (avg PV vs avg consumption per hour).
	 * Falls back to brightsky forecast if no historical PV available.
	 */
	_findSolarSufficiencyTime(pvProduction, cheapPhaseEndHour, consumptionAnalysis) {
		const hasHistoricalPv = consumptionAnalysis && consumptionAnalysis.hourlyPvAverageKwh &&
			consumptionAnalysis.hourlyPvAverageKwh.some(v => v > 0);
		const hasHistoricalConsumption = consumptionAnalysis &&
			consumptionAnalysis.hourly &&
			consumptionAnalysis.overall.dataPoints > 0;

		if (hasHistoricalPv && hasHistoricalConsumption) {
			// Use historical averages: find first hour after cheap phase end where PV >= consumption
			const startH = Math.ceil(cheapPhaseEndHour);
			for (let h = startH; h < 24; h++) {
				const pvKwh     = consumptionAnalysis.hourlyPvAverageKwh[h]; // conservatism already applied
				const consumKwh = (consumptionAnalysis.hourly.averageByHour[h] || 0) / 1000;
				if (consumKwh > 0 && pvKwh >= consumKwh) {
					this._adapter.log.debug(
						`SmartChargingPlanner: Historical solar sufficiency at ${h}:00 ` +
						`(PV ${pvKwh.toFixed(2)} kWh >= consumption ${consumKwh.toFixed(2)} kWh)`
					);
					return h;
				}
			}
			this._adapter.log.debug('SmartChargingPlanner: Historical PV never covers consumption → falling back to forecast');
		}

		// Forecast-based (brightsky) sufficiency detection
		const hasHistory = hasHistoricalConsumption;
		for (const hour of pvProduction) {
			const hourDecimal = hour.timestamp.getHours() + hour.timestamp.getMinutes() / 60;
			if (hourDecimal < cheapPhaseEndHour) continue;

			const threshold = hasHistory
				? (consumptionAnalysis.hourly.averageByHour[hour.timestamp.getHours()] || 0) / 1000
				: this._pvSufficiencyThreshold;

			if (hour.estimatedKwh >= threshold) {
				return hourDecimal;
			}
		}

		const fallback = Math.max(cheapPhaseEndHour + 4, 12);
		this._adapter.log.warn(
			`SmartChargingPlanner: Solar sufficiency not found in any data source, ` +
			`using conservative fallback ${this._formatHour(fallback)}`
		);
		return fallback;
	}

	/**
	 * Read the cheap electricity phase from ioBroker pricing states.
	 * Identifies cheaper timeslot by comparing grossRates of timeslot_0 and timeslot_1.
	 */
	async _getCheapPhaseFromPricing() {
		try {
			const rate0State = await this._adapter.getStateAsync('pricing.malo_0_agreement_0.timeslot_0.grossRate');
			const rate1State = await this._adapter.getStateAsync('pricing.malo_0_agreement_0.timeslot_1.grossRate');

			if (!rate0State || rate0State.val === null || !rate1State || rate1State.val === null) {
				this._adapter.log.debug('SmartChargingPlanner: Pricing rate states not yet populated');
				return null;
			}

			const cheapIdx = rate0State.val <= rate1State.val ? 0 : 1;
			const cheapRate = cheapIdx === 0 ? rate0State.val : rate1State.val;

			this._adapter.log.debug(`SmartChargingPlanner: Cheap timeslot=${cheapIdx} (${cheapRate} ct/kWh)`);

			const fromState = await this._adapter.getStateAsync(
				`pricing.malo_0_agreement_0.timeslot_${cheapIdx}.activeFrom_0`
			);
			const toState = await this._adapter.getStateAsync(
				`pricing.malo_0_agreement_0.timeslot_${cheapIdx}.activeTo_0`
			);

			if (!fromState || !fromState.val || !toState || !toState.val) {
				this._adapter.log.warn('SmartChargingPlanner: Pricing activation rules not yet available');
				return null;
			}

			const startHour = this._parseTimeToDecimalHour(fromState.val);
			const endHour   = this._parseTimeToDecimalHour(toState.val);

			this._adapter.log.info(
				`SmartChargingPlanner: Cheap phase ${fromState.val}–${toState.val} (${cheapRate} ct/kWh)`
			);

			return { startHour, endHour, grossRate: cheapRate };
		} catch (error) {
			this._adapter.log.error(`SmartChargingPlanner: Error reading pricing states: ${error.message}`);
			return null;
		}
	}

	_parseTimeToDecimalHour(timeStr) {
		if (!timeStr) return 0;
		const [h, m] = timeStr.split(':').map(Number);
		return h + (m || 0) / 60;
	}

	_formatHour(decimalHour) {
		const h = Math.floor(decimalHour);
		const m = Math.round((decimalHour - h) * 60);
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}

	_scheduleNextCalculation() {
		const calcTime = this._config.smartChargingCalcTime || '22:00';
		const [targetHour, targetMin] = calcTime.split(':').map(Number);

		const now = new Date();
		const next = new Date(now);
		next.setHours(targetHour, targetMin, 0, 0);
		if (next <= now) {
			next.setDate(next.getDate() + 1);
		}

		const msUntilNext = next.getTime() - now.getTime();
		this._adapter.log.info(
			`SmartChargingPlanner: Next calculation scheduled at ${next.toLocaleString()} ` +
			`(in ${Math.round(msUntilNext / 60000)} min)`
		);

		this._dailyTimer = setTimeout(async () => {
			await this.calculate();
			this._scheduleNextCalculation();
		}, msUntilNext);
	}

	async shutdown() {
		// Disable grid charging on shutdown to leave evcc in clean state
		if (this._gridChargingActive) {
			await this._setEvccGridChargeLimit(false).catch(() => {});
		}
		if (this._controlInterval) {
			clearInterval(this._controlInterval);
			this._controlInterval = null;
		}
		if (this._dailyTimer) {
			clearTimeout(this._dailyTimer);
			this._dailyTimer = null;
		}
		this._adapter.log.info('SmartChargingPlanner: Shutdown complete');
	}
}

module.exports = {
	WeatherService,
	PVForecast,
	EVCCAdapter,
	ClaudeAI,
	ConsumptionAnalyzer,
	AIDecisionEngine,
	SmartChargingPlanner
};
