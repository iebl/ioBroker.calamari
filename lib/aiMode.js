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
const mqtt = require('mqtt');
const { Anthropic } = require('@anthropic-ai/sdk');

/**
 * Weather Service - Fetches weather forecasts from different providers
 */
class WeatherService {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._provider = config.weatherApiProvider || 'openweathermap';
		this._apiKey = config.weatherApiKey;
		this._lat = config.locationLat;
		this._lon = config.locationLon;
	}

	/**
	 * Fetch weather forecast for the next days
	 * @param {number} days - Number of days to forecast
	 * @returns {Promise<Array>} Hourly forecast data
	 */
	async getForecast(days = 2) {
		try {
			switch (this._provider) {
				case 'openweathermap':
					return await this._getOpenWeatherMapForecast(days);
				case 'weatherapi':
					return await this._getWeatherApiForecast(days);
				case 'tomorrow':
					return await this._getTomorrowIoForecast(days);
				default:
					throw new Error(`Unknown weather provider: ${this._provider}`);
			}
		} catch (error) {
			this._adapter.log.error(`Weather forecast fetch failed: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Fetch forecast from OpenWeatherMap
	 */
	async _getOpenWeatherMapForecast(days) {
		const url = 'https://api.openweathermap.org/data/2.5/forecast';
		const response = await axios.get(url, {
			params: {
				lat: this._lat,
				lon: this._lon,
				appid: this._apiKey,
				units: 'metric',
				cnt: days * 8 // 8 forecasts per day (3-hour intervals)
			}
		});

		return response.data.list.map(item => ({
			timestamp: new Date(item.dt * 1000),
			temperature: item.main.temp,
			cloudCoverage: item.clouds.all, // 0-100%
			description: item.weather[0].description,
			precipitation: item.rain?.['3h'] || 0,
			windSpeed: item.wind.speed
		}));
	}

	/**
	 * Fetch forecast from WeatherAPI.com
	 */
	async _getWeatherApiForecast(days) {
		const url = 'https://api.weatherapi.com/v1/forecast.json';
		const response = await axios.get(url, {
			params: {
				key: this._apiKey,
				q: `${this._lat},${this._lon}`,
				days: days,
				aqi: 'no'
			}
		});

		const hourlyData = [];
		response.data.forecast.forecastday.forEach(day => {
			day.hour.forEach(hour => {
				hourlyData.push({
					timestamp: new Date(hour.time),
					temperature: hour.temp_c,
					cloudCoverage: hour.cloud,
					description: hour.condition.text,
					precipitation: hour.precip_mm,
					windSpeed: hour.wind_kph / 3.6 // Convert to m/s
				});
			});
		});

		return hourlyData;
	}

	/**
	 * Fetch forecast from Tomorrow.io
	 */
	async _getTomorrowIoForecast(days) {
		const url = 'https://api.tomorrow.io/v4/timelines';
		const endTime = new Date();
		endTime.setDate(endTime.getDate() + days);

		const response = await axios.get(url, {
			params: {
				apikey: this._apiKey,
				location: `${this._lat},${this._lon}`,
				fields: 'temperature,cloudCover,precipitationIntensity,windSpeed',
				units: 'metric',
				timesteps: '1h',
				endTime: endTime.toISOString()
			}
		});

		const timeline = response.data.data.timelines[0];
		return timeline.intervals.map(interval => ({
			timestamp: new Date(interval.startTime),
			temperature: interval.values.temperature,
			cloudCoverage: interval.values.cloudCover,
			description: 'Forecast',
			precipitation: interval.values.precipitationIntensity,
			windSpeed: interval.values.windSpeed
		}));
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

		// Solar irradiance estimation (simplified model)
		const solarIrradiance = this._estimateSolarIrradiance(hour, weather.timestamp, weather.cloudCoverage);

		// Orientation factor
		const orientationFactor = this._getOrientationFactor(hour, array.orientation);

		// Tilt factor (simplified)
		const tiltFactor = this._getTiltFactor(array.tilt, this._lat);

		// Temperature derating (PV efficiency decreases with temperature)
		const tempDerating = 1 - ((weather.temperature - 25) * 0.004);

		// Cloud coverage derating
		const cloudDerating = 1 - (weather.cloudCoverage / 100 * 0.75);

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
 * MQTT Client - Connects to evcc for real-time consumption and PV data
 */
class EVCCClient {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._config = config;
		this._client = null;
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
	 * Connect to MQTT broker
	 */
	async connect() {
		if (!this._config.mqttEnabled) {
			this._adapter.log.info('MQTT disabled in configuration');
			return false;
		}

		const options = {
			host: this._config.mqttHost,
			port: this._config.mqttPort,
			reconnectPeriod: 5000
		};

		if (this._config.mqttUsername) {
			options.username = this._config.mqttUsername;
			options.password = this._config.mqttPassword;
		}

		return new Promise((resolve, reject) => {
			try {
				this._client = mqtt.connect(options);

				this._client.on('connect', () => {
					this._adapter.log.info('Connected to MQTT broker');
					this._data.connected = true;
					this._subscribeToTopics();
					resolve(true);
				});

				this._client.on('error', (error) => {
					this._adapter.log.error(`MQTT error: ${error.message}`);
					this._data.connected = false;
					reject(error);
				});

				this._client.on('message', (topic, message) => {
					this._handleMessage(topic, message);
				});

				this._client.on('close', () => {
					this._adapter.log.info('MQTT connection closed');
					this._data.connected = false;
				});
			} catch (error) {
				this._adapter.log.error(`MQTT connection failed: ${error.message}`);
				reject(error);
			}
		});
	}

	/**
	 * Subscribe to evcc topics
	 */
	_subscribeToTopics() {
		const baseTopic = this._config.evccBaseTopic || 'evcc';
		const topics = [
			`${baseTopic}/site/pvPower`,
			`${baseTopic}/site/batteryPower`,
			`${baseTopic}/site/batterySoc`,
			`${baseTopic}/site/gridPower`,
			`${baseTopic}/site/homePower`
		];

		topics.forEach(topic => {
			this._client.subscribe(topic, (err) => {
				if (err) {
					this._adapter.log.error(`Failed to subscribe to ${topic}: ${err.message}`);
				} else {
					this._adapter.log.debug(`Subscribed to ${topic}`);
				}
			});
		});
	}

	/**
	 * Handle incoming MQTT messages
	 */
	_handleMessage(topic, message) {
		try {
			const value = parseFloat(message.toString());
			const baseTopic = this._config.evccBaseTopic || 'evcc';

			if (topic === `${baseTopic}/site/pvPower`) {
				this._data.pvPower = value;
			} else if (topic === `${baseTopic}/site/batteryPower`) {
				this._data.batteryPower = value;
			} else if (topic === `${baseTopic}/site/batterySoc`) {
				this._data.batterySoc = value;
			} else if (topic === `${baseTopic}/site/gridPower`) {
				this._data.gridPower = value;
			} else if (topic === `${baseTopic}/site/homePower`) {
				this._data.homePower = value;
			}

			this._adapter.log.debug(`MQTT update: ${topic} = ${value}`);
		} catch (error) {
			this._adapter.log.error(`Error processing MQTT message: ${error.message}`);
		}
	}

	/**
	 * Get current evcc data
	 */
	getData() {
		return { ...this._data };
	}

	/**
	 * Disconnect from MQTT broker
	 */
	disconnect() {
		if (this._client) {
			this._client.end();
			this._client = null;
			this._data.connected = false;
			this._adapter.log.info('Disconnected from MQTT broker');
		}
	}
}

/**
 * Claude AI Client - Makes intelligent decisions based on all available data
 */
class ClaudeAI {
	constructor(adapter, config) {
		this._adapter = adapter;
		this._apiKey = config.claudeApiKey;
		this._model = config.claudeModel || 'claude-3-5-sonnet-20241022';
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

			this._adapter.log.debug('Requesting charging decision from Claude AI');

			const message = await this._client.messages.create({
				model: this._model,
				max_tokens: 1024,
				messages: [{
					role: 'user',
					content: prompt
				}]
			});

			const response = message.content[0].text;
			return this._parseDecisionResponse(response);
		} catch (error) {
			this._adapter.log.error(`Claude AI decision failed: ${error.message}`);
			throw error;
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

		let condition = 'mostly sunny';
		if (avgCloud > 70) condition = 'mostly cloudy';
		else if (avgCloud > 40) condition = 'partly cloudy';

		return `Condition: ${condition} (${avgCloud.toFixed(0)}% cloud coverage)
Temperature: ${avgTemp.toFixed(1)}°C average
Precipitation: ${totalPrecip.toFixed(1)} mm total`;
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
		this._historyInstance = config.historyInstance || 'history.0';
		this._evccPowerState = config.evccPowerState || 'evcc.0.site.homePower';
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
		this._evccClient = new EVCCClient(adapter, config);
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
	EVCCClient,
	ClaudeAI,
	ConsumptionAnalyzer,
	AIDecisionEngine
};
