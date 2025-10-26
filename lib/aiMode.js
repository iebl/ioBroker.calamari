/**
 * AI Mode Module for ioBroker.calamari
 *
 * This module provides intelligent battery charging decisions based on:
 * - Weather forecasts
 * - PV production predictions
 * - Current consumption data from evcc
 * - Electricity price dispatches from Octopus
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
	 * Fetch weather forecast for the next days from brightsky adapter
	 * @param {number} days - Number of days to forecast (default 2)
	 * @returns {Promise<Array>} Hourly forecast data
	 */
	async getForecast(days = 2) {
		try {
			this._adapter.log.debug(`Fetching ${days} days forecast from brightsky adapter: ${this._brightskyInstance}`);

			const hourlyData = [];
			const maxHours = days * 24;

			// brightsky adapter stores hourly forecasts in hourly.x.* structure
			for (let hour = 0; hour < maxHours; hour++) {
				try {
					const basePath = `${this._brightskyInstance}.hourly.${hour}`;

					// Read forecast data for this hour
					const timestampState = await this._adapter.getForeignStateAsync(`${basePath}.time`);
					const tempState = await this._adapter.getForeignStateAsync(`${basePath}.temp`);
					const cloudState = await this._adapter.getForeignStateAsync(`${basePath}.clouds`);
					const precipState = await this._adapter.getForeignStateAsync(`${basePath}.prec_sum`);
					const windState = await this._adapter.getForeignStateAsync(`${basePath}.wind_speed`);
					const conditionState = await this._adapter.getForeignStateAsync(`${basePath}.condition`);

					// Solar-relevant data for PV forecasting
					const solarState = await this._adapter.getForeignStateAsync(`${basePath}.solar`);
					const solar60State = await this._adapter.getForeignStateAsync(`${basePath}.solar_60`);
					const sunshineState = await this._adapter.getForeignStateAsync(`${basePath}.sunshine`);
					const sunshine60State = await this._adapter.getForeignStateAsync(`${basePath}.sunshine_60`);
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
						// Solar data for PV production forecasting
						solarIrradiation: solarState?.val || solar60State?.val || null, // kWh/m²
						sunshineDuration: sunshineState?.val || sunshine60State?.val || null, // minutes or seconds
						visibility: visibilityState?.val || null // meters
					});
				} catch (error) {
					this._adapter.log.debug(`Could not read forecast hour ${hour}: ${error.message}`);
				}
			}

			if (hourlyData.length === 0) {
				this._adapter.log.warn('No weather forecast data available from brightsky adapter');
				// Return fallback data
				return this._getFallbackForecast(days);
			}

			this._adapter.log.info(`Successfully fetched ${hourlyData.length} hours of weather forecast from brightsky`);
			return hourlyData;

		} catch (error) {
			this._adapter.log.error(`Weather forecast fetch failed: ${error.message}`);
			return this._getFallbackForecast(days);
		}
	}

	/**
	 * Generate fallback forecast data if brightsky is not available
	 */
	_getFallbackForecast(days) {
		this._adapter.log.warn('Using fallback weather forecast (partly cloudy, 15°C)');
		const hourlyData = [];
		const now = new Date();

		for (let i = 0; i < days * 24; i++) {
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
		const diff = date - start;
		const oneDay = 1000 * 60 * 60 * 24;
		return Math.floor(diff / oneDay);
	}
}

/**
 * EVCC Adapter Client - Reads data from evcc ioBroker adapter
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
			homePower: 0,
			connected: false
		};
	}

	/**
	 * Initialize and check if evcc adapter is available
	 */
	async connect() {
		try {
			// Check if evcc adapter is installed and running
			const state = await this._adapter.getForeignStateAsync(`${this._evccInstance}.info.connection`);
			if (state && state.val) {
				this._data.connected = true;
				this._adapter.log.info(`Connected to evcc adapter: ${this._evccInstance}`);
				await this._readCurrentData();
				return true;
			} else {
				this._adapter.log.warn(`evcc adapter ${this._evccInstance} not connected`);
				return false;
			}
		} catch (error) {
			this._adapter.log.error(`Failed to connect to evcc adapter: ${error.message}`);
			return false;
		}
	}

	/**
	 * Read current data from evcc adapter states
	 */
	async _readCurrentData() {
		try {
			// Read from evcc.X.status.* states
			const pvState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.pvPower`);
			const batteryPowerState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.batteryPower`);
			const batterySocState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.batterySoc`);
			const gridState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.gridPower`);
			const homeState = await this._adapter.getForeignStateAsync(`${this._evccInstance}.status.homePower`);

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
	 * Disconnect (no-op for adapter-based client)
	 */
	disconnect() {
		this._data.connected = false;
		this._adapter.log.info('Disconnected from evcc adapter');
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
			this._adapter.log.debug(`AI Response: ${message.content[0].text.substring(0, 200)}...`);

			const response = message.content[0].text;
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

			return {
				success: true,
				message: `Connection successful! Model: ${this._model}, Response time: ${duration}ms`,
				model: this._model,
				responseTime: duration,
				response: message.content[0].text
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
		// Add consumption analysis if available
		const consumptionSection = context.consumptionAnalysis
			? `\nHISTORICAL CONSUMPTION PATTERNS (last 7 days):
${this._formatConsumptionAnalysis(context.consumptionAnalysis)}
`
			: '';

		return `You are an energy management AI assistant. Your task is to decide whether to charge a home battery from the grid during cheap electricity phases.

CURRENT SITUATION:
- Current battery SOC: ${context.currentBatterySoc}%
- Battery capacity: ${context.batteryCapacity} kWh
- Minimum SOC allowed: ${context.batteryMinSoc}%
- Maximum charge power: ${context.batteryMaxChargePower} kW

CURRENT CONSUMPTION:
- Home power: ${context.currentHomePower} W
- PV power: ${context.currentPvPower} W
- Grid power: ${context.currentGridPower} W
${consumptionSection}
CHEAP ELECTRICITY PHASES (next 24h):
${context.cheapPhases.map(phase =>
	`- ${phase.start} to ${phase.end}: ${phase.deltaKwh} kWh available at low price`
).join('\n')}

PV PRODUCTION FORECAST (next 24h):
${this._summarizePvForecast(context.pvForecast)}

WEATHER FORECAST (next 24h):
${this._summarizeWeatherForecast(context.weatherForecast)}

DECISION CRITERIA:
1. If PV forecast is good (sunny weather), charging from grid may not be necessary
2. If PV forecast is poor (cloudy/rainy), charging during cheap phases is beneficial
3. Consider current battery SOC and available cheap phase capacity
4. Use historical consumption patterns to predict future needs
5. Account for peak consumption hours when battery discharge is most valuable
6. Consider day of week (weekday vs weekend) for consumption patterns
7. Ensure battery doesn't drop below minimum SOC

Please provide your decision in the following JSON format:
{
  "shouldCharge": true/false,
  "reason": "Brief explanation of your decision",
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
	}

	/**
	 * Get historical consumption data
	 * @param {number} days - Number of days to fetch
	 * @returns {Promise<Array>} Historical data points
	 */
	async getHistoricalData(days = 7) {
		try {
			const end = new Date();
			const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

			this._adapter.log.debug(`Fetching ${days} days of consumption history from ${this._historyInstance}`);

			return new Promise((resolve, reject) => {
				this._adapter.sendTo(this._historyInstance, 'getHistory', {
					id: this._evccPowerState,
					options: {
						start: start.getTime(),
						end: end.getTime(),
						aggregate: 'average',
						step: 900000 // 15 minutes in milliseconds
					}
				}, (result) => {
					if (result.error) {
						this._adapter.log.error(`History query failed: ${result.error}`);
						reject(new Error(result.error));
					} else if (!result.result || result.result.length === 0) {
						this._adapter.log.warn('No historical data available');
						resolve([]);
					} else {
						this._adapter.log.debug(`Fetched ${result.result.length} historical data points`);
						resolve(result.result);
					}
				});
			});
		} catch (error) {
			this._adapter.log.error(`Error fetching historical data: ${error.message}`);
			return [];
		}
	}

	/**
	 * Analyze consumption patterns
	 * @returns {Promise<Object>} Consumption analysis
	 */
	async analyzeConsumption() {
		try {
			const historicalData = await this.getHistoricalData(7);

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
				patterns: this._identifyPatterns(hourlyAverage, weekdayAverage)
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
			note: 'Using default values - no historical data available'
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

			// Connect to MQTT if enabled
			if (this._config.mqttEnabled) {
				await this._evccClient.connect();
			}

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
	 * Schedule daily decision making
	 */
	_scheduleDecision() {
		// Parse decision time (e.g., "17:30")
		const [hours, minutes] = (this._config.aiDecisionTime || '17:30').split(':').map(Number);

		// Calculate next decision time
		const now = new Date();
		const nextDecision = new Date();
		nextDecision.setHours(hours, minutes, 0, 0);

		// If time has passed today, schedule for tomorrow
		if (nextDecision <= now) {
			nextDecision.setDate(nextDecision.getDate() + 1);
		}

		const msUntilDecision = nextDecision - now;

		this._adapter.log.info(`Next AI decision scheduled for ${nextDecision.toLocaleString()}`);

		// Schedule the decision
		setTimeout(() => {
			this.makeDecision();
			// After first execution, schedule daily
			this._decisionInterval = setInterval(() => {
				this.makeDecision();
			}, 24 * 60 * 60 * 1000); // Daily
		}, msUntilDecision);
	}

	/**
	 * Make a charging decision
	 */
	async makeDecision() {
		try {
			this._adapter.log.info('Starting AI charging decision process');

			// Gather all required data
			const context = await this._gatherDecisionContext();

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
		// Get weather forecast
		const weatherForecast = await this._weatherService.getForecast(this._config.aiConsiderDays || 2);

		// Calculate PV production forecast
		const pvForecast = this._pvForecast.calculateProduction(weatherForecast);

		// Get current evcc data
		const evccData = this._evccClient.getData();

		// Get cheap phases from adapter states (planned dispatches)
		const cheapPhases = await this._getCheapPhases();

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
			batteryMaxChargePower: this._config.batteryMaxChargePower,
			currentHomePower: evccData.homePower,
			currentPvPower: evccData.pvPower,
			currentGridPower: evccData.gridPower,
			cheapPhases: cheapPhases,
			pvForecast: pvForecast,
			weatherForecast: weatherForecast,
			consumptionAnalysis: consumptionAnalysis,
			timestamp: new Date().toISOString()
		};
	}

	/**
	 * Get cheap electricity phases from adapter states
	 */
	async _getCheapPhases() {
		try {
			// Read plannedDispatches from adapter state
			const state = await this._adapter.getStateAsync('devices.0.vehicle.plannedDispatches');
			if (!state || !state.val) {
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

		if (this._decisionInterval) {
			clearInterval(this._decisionInterval);
			this._decisionInterval = null;
		}

		this._evccClient.disconnect();
	}
}

module.exports = {
	WeatherService,
	PVForecast,
	EVCCAdapter,
	ClaudeAI,
	ConsumptionAnalyzer,
	AIDecisionEngine
};
