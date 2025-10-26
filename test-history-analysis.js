/**
 * Test script for History Data Analysis
 *
 * This script tests the ConsumptionAnalyzer functionality to verify that
 * historical consumption data can be fetched and analyzed correctly.
 *
 * Usage:
 *   node test-history-analysis.js
 *
 * Requirements:
 * - ioBroker must be running
 * - History adapter (sql.0, history.0, or influxdb.0) must be configured
 * - evcc.0.status.homePower must be logged in the history adapter
 */

const { ConsumptionAnalyzer } = require('./lib/aiMode.js');

// Mock adapter for testing
class MockAdapter {
	constructor() {
		this.name = 'calamari';
	}

	log = {
		info: (msg) => console.log(`[INFO] ${msg}`),
		warn: (msg) => console.warn(`[WARN] ${msg}`),
		error: (msg) => console.error(`[ERROR] ${msg}`),
		debug: (msg) => console.log(`[DEBUG] ${msg}`)
	};

	sendTo(target, command, message, callback) {
		console.log(`\n📡 sendTo called:`);
		console.log(`   Target: ${target}`);
		console.log(`   Command: ${command}`);
		console.log(`   Message:`, JSON.stringify(message, null, 2));

		// In real adapter, this would call the history adapter
		// For testing, we need to connect to actual ioBroker
		// We'll use require('iobroker.js-controller') to get the adapter

		// Try to get real adapter connection
		try {
			const adapterCore = require('@iobroker/adapter-core');
			const realAdapter = adapterCore.adapter({
				name: 'test-history',
				ready: function() {
					this.sendTo(target, command, message, (result) => {
						console.log(`\n✅ History response received`);
						console.log(`   Result length: ${result?.result?.length || 0}`);
						if (result.error) {
							console.error(`   ❌ Error: ${result.error}`);
						}
						callback(result);

						// Stop adapter after callback
						setTimeout(() => {
							this.terminate ? this.terminate() : process.exit(0);
						}, 1000);
					});
				}
			});
		} catch (error) {
			console.error(`❌ Could not create adapter connection: ${error.message}`);
			console.log(`\nℹ️  This test must be run in an ioBroker environment.`);
			process.exit(1);
		}
	}
}

async function testHistoryAnalysis() {
	console.log('═══════════════════════════════════════════════════════════');
	console.log('  🧪 History Data Analysis Test');
	console.log('═══════════════════════════════════════════════════════════\n');

	// Configuration
	const config = {
		historyInstance: 'sql.0',  // Change to your history adapter instance
		evccPowerState: 'evcc.0.status.homePower',  // Change to your state
		historyAnalysisDays: 7
	};

	console.log('📋 Configuration:');
	console.log(`   History Instance: ${config.historyInstance}`);
	console.log(`   Power State: ${config.evccPowerState}`);
	console.log(`   Analysis Days: ${config.historyAnalysisDays}`);
	console.log('');

	// Create mock adapter
	const mockAdapter = new MockAdapter();

	// Create analyzer
	const analyzer = new ConsumptionAnalyzer(mockAdapter, config);

	try {
		console.log('🔍 Step 1: Fetching historical data...\n');

		const historicalData = await analyzer.getHistoricalData(config.historyAnalysisDays);

		console.log(`\n✅ Historical data fetched: ${historicalData.length} data points`);

		if (historicalData.length > 0) {
			// Show sample data
			console.log('\n📊 Sample data (first 5 points):');
			historicalData.slice(0, 5).forEach((point, index) => {
				const date = new Date(point.ts);
				console.log(`   ${index + 1}. ${date.toISOString()} - ${point.val}W`);
			});

			// Show date range
			const firstDate = new Date(historicalData[0].ts);
			const lastDate = new Date(historicalData[historicalData.length - 1].ts);
			console.log('\n📅 Data Range:');
			console.log(`   From: ${firstDate.toISOString()}`);
			console.log(`   To:   ${lastDate.toISOString()}`);
			console.log(`   Days: ${((lastDate - firstDate) / (1000 * 60 * 60 * 24)).toFixed(1)}`);

			console.log('\n🔍 Step 2: Analyzing consumption patterns...\n');

			const analysis = await analyzer.analyzeConsumption();

			console.log('\n═══════════════════════════════════════════════════════════');
			console.log('  📊 ANALYSIS RESULTS');
			console.log('═══════════════════════════════════════════════════════════\n');

			console.log('📈 Overall Statistics:');
			console.log(`   Average Power: ${analysis.overall.averagePower.toFixed(0)}W`);
			console.log(`   Daily Consumption: ${analysis.overall.dailyConsumption.toFixed(2)} kWh`);
			console.log(`   Data Points: ${analysis.overall.dataPoints}`);
			console.log(`   Days Analyzed: ${analysis.overall.daysAnalyzed}`);

			console.log('\n⏰ Hourly Patterns:');
			console.log('   Peak Hours:');
			analysis.hourly.peakHours.forEach((peak, index) => {
				console.log(`      ${index + 1}. ${peak.hour}:00 - ${peak.power.toFixed(0)}W`);
			});
			console.log('   Low Hours:');
			analysis.hourly.lowHours.forEach((low, index) => {
				console.log(`      ${index + 1}. ${low.hour}:00 - ${low.power.toFixed(0)}W`);
			});

			console.log('\n📅 Weekly Patterns:');
			console.log(`   Weekday Average: ${analysis.weekly.weekdayAverage.toFixed(0)}W`);
			console.log(`   Weekend Average: ${analysis.weekly.weekendAverage.toFixed(0)}W`);
			console.log(`   Difference: ${((analysis.weekly.weekendAverage - analysis.weekly.weekdayAverage) / analysis.weekly.weekdayAverage * 100).toFixed(1)}%`);

			console.log('\n🔍 Identified Patterns:');
			analysis.patterns.forEach((pattern, index) => {
				console.log(`   ${index + 1}. ${pattern}`);
			});

			if (analysis.note) {
				console.log(`\n⚠️  Note: ${analysis.note}`);
			}

			console.log('\n📝 Hourly Breakdown (24h):');
			console.log('   Hour | Power  | Bar');
			console.log('   -----|--------|' + '─'.repeat(40));
			const maxPower = Math.max(...analysis.hourly.averageByHour);
			for (let hour = 0; hour < 24; hour++) {
				const power = analysis.hourly.averageByHour[hour];
				const barLength = Math.round((power / maxPower) * 30);
				const bar = '█'.repeat(barLength);
				console.log(`   ${String(hour).padStart(2, '0')}:00 | ${String(power.toFixed(0)).padStart(6)}W | ${bar}`);
			}

			console.log('\n🤖 AI Prompt Format:');
			console.log('───────────────────────────────────────────────────────────');
			const promptText = analyzer.formatForPrompt(analysis);
			console.log(promptText);
			console.log('───────────────────────────────────────────────────────────');

			console.log('\n✅ Test completed successfully!');
			console.log('\nℹ️  This data will be sent to Claude AI for intelligent charging decisions.');

		} else {
			console.log('\n⚠️  No historical data available!');
			console.log('\nPossible reasons:');
			console.log('   1. History adapter is not configured');
			console.log('   2. State is not being logged: ' + config.evccPowerState);
			console.log('   3. Not enough historical data (< 7 days)');
			console.log('   4. History adapter instance name is incorrect');
			console.log('\n💡 Please check:');
			console.log(`   - History adapter ${config.historyInstance} is running`);
			console.log(`   - State ${config.evccPowerState} is being logged`);
			console.log('   - At least 7 days of data has been collected');

			console.log('\n📋 Using default analysis instead:');
			const defaultAnalysis = await analyzer.analyzeConsumption();
			console.log(`   Daily Consumption: ${defaultAnalysis.overall.dailyConsumption} kWh (default)`);
			console.log(`   Note: ${defaultAnalysis.note}`);
		}

	} catch (error) {
		console.error('\n❌ Test failed with error:');
		console.error(`   ${error.message}`);
		console.error('\nStack trace:');
		console.error(error.stack);
		process.exit(1);
	}
}

// Run test
testHistoryAnalysis().catch(error => {
	console.error('\n❌ Unhandled error:', error);
	process.exit(1);
});
