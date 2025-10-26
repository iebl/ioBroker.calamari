#!/usr/bin/env node
/**
 * Real History Data Test
 *
 * This script must be run from your ioBroker installation directory.
 * It will query your actual history adapter and analyze real consumption data.
 *
 * Usage:
 *   cd /opt/iobroker  (or your ioBroker directory)
 *   node /home/trammer/ioBroker.calamari/test-real-history.js
 */

// Configuration - ADJUST TO YOUR SETUP
const CONFIG = {
	historyInstance: 'sql.0',              // Change to your history adapter: history.0, sql.0, influxdb.0
	evccPowerState: 'evcc.0.status.homePower',
	days: 7
};

console.log('═══════════════════════════════════════════════════════════');
console.log('  🔍 Real History Data Test');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('📋 Configuration:');
console.log(`   History Instance: ${CONFIG.historyInstance}`);
console.log(`   State: ${CONFIG.evccPowerState}`);
console.log(`   Days: ${CONFIG.days}\n`);

async function testRealHistory() {
	let ConsumptionAnalyzer;

	try {
		// Load ConsumptionAnalyzer from adapter directory
		const adapterPath = '/home/trammer/ioBroker.calamari';
		ConsumptionAnalyzer = require(`${adapterPath}/lib/aiMode.js`).ConsumptionAnalyzer;
		console.log(`✅ Loaded ConsumptionAnalyzer from ${adapterPath}\n`);
	} catch (error) {
		console.error(`❌ Could not load ConsumptionAnalyzer: ${error.message}`);
		console.log('\n💡 Make sure the adapter path is correct.');
		process.exit(1);
	}

	try {
		// Load adapter-core from ioBroker installation
		const adapterCore = require('@iobroker/adapter-core');
		console.log('✅ Found @iobroker/adapter-core\n');

		// Create temporary adapter for testing
		const adapter = adapterCore.adapter({
			name: 'test',

			ready: async function() {
				console.log('✅ Adapter initialized\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
				console.log('🔍 Testing History Adapter Connection\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

				// Test history adapter connection first
				const end = new Date();
				const start = new Date(end.getTime() - CONFIG.days * 24 * 60 * 60 * 1000);

				console.log(`📅 Query Range:`);
				console.log(`   From: ${start.toISOString()}`);
				console.log(`   To:   ${end.toISOString()}\n`);

				console.log(`📡 Querying ${CONFIG.historyInstance}...\n`);

				this.sendTo(CONFIG.historyInstance, 'getHistory', {
					id: CONFIG.evccPowerState,
					options: {
						start: start.getTime(),
						end: end.getTime(),
						aggregate: 'average',
						step: 900000  // 15 minutes
					}
				}, async (result) => {
					if (result.error) {
						console.error(`❌ History query failed: ${result.error}\n`);
						console.log('💡 Troubleshooting:');
						console.log(`   1. Check if ${CONFIG.historyInstance} is running:`);
						console.log(`      $ iobroker status ${CONFIG.historyInstance}`);
						console.log(`   2. Try different instance names in CONFIG above:`);
						console.log(`      - history.0`);
						console.log(`      - sql.0`);
						console.log(`      - influxdb.0`);
						console.log(`   3. Check if state exists and is being logged: ${CONFIG.evccPowerState}\n`);
						this.terminate();
						return;
					}

					if (!result.result || result.result.length === 0) {
						console.warn(`⚠️  No data returned from ${CONFIG.historyInstance}\n`);
						console.log('💡 Possible reasons:');
						console.log(`   1. State ${CONFIG.evccPowerState} is not being logged`);
						console.log('   2. Not enough historical data collected yet');
						console.log('   3. State path is incorrect\n');
						console.log('🔧 To enable logging:');
						console.log(`   1. Admin UI → Objects → ${CONFIG.evccPowerState}`);
						console.log('   2. Click settings icon (wrench)');
						console.log('   3. Enable logging in your history adapter');
						console.log('   4. Wait for data to be collected\n');
						this.terminate();
						return;
					}

					const rawData = result.result;
					console.log(`✅ ${rawData.length} data points received!\n`);

					// Basic info
					const firstDate = new Date(rawData[0].ts);
					const lastDate = new Date(rawData[rawData.length - 1].ts);
					const daysCovered = ((lastDate - firstDate) / (1000 * 60 * 60 * 24)).toFixed(1);

					console.log('📊 Raw Data Info:');
					console.log(`   First: ${firstDate.toISOString()}`);
					console.log(`   Last:  ${lastDate.toISOString()}`);
					console.log(`   Span:  ${daysCovered} days\n`);

					console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
					console.log('📊 Running ConsumptionAnalyzer\n');
					console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

					// Create analyzer
					const analyzerConfig = {
						historyInstance: CONFIG.historyInstance,
						evccPowerState: CONFIG.evccPowerState,
						historyAnalysisDays: CONFIG.days,
						enableHistoryAnalysis: true
					};

					const analyzer = new ConsumptionAnalyzer(this, analyzerConfig);

					try {
						// Run analysis
						const startTime = Date.now();
						const analysis = await analyzer.analyzeConsumption();
						const duration = Date.now() - startTime;

						console.log(`⏱️  Analysis completed in ${duration}ms\n`);

						console.log('═══════════════════════════════════════════════════════════');
						console.log('  📊 ANALYSIS RESULTS - YOUR REAL DATA');
						console.log('═══════════════════════════════════════════════════════════\n');

						// Overall statistics
						console.log('📈 Overall Statistics:');
						console.log(`   Average Power:      ${analysis.overall.averagePower.toFixed(0)}W`);
						console.log(`   Daily Consumption:  ${analysis.overall.dailyConsumption.toFixed(2)} kWh`);
						console.log(`   Data Points:        ${analysis.overall.dataPoints}`);
						console.log(`   Days Analyzed:      ${analysis.overall.daysAnalyzed}\n`);

						// Hourly patterns
						console.log('⏰ Peak Hours (> 130% of average):');
						if (analysis.hourly.peakHours.length > 0) {
							analysis.hourly.peakHours.forEach((peak, i) => {
								const percentage = ((peak.power / analysis.overall.averagePower - 1) * 100).toFixed(0);
								console.log(`   ${i + 1}. ${String(peak.hour).padStart(2, '0')}:00 - ${peak.power.toFixed(0)}W (+${percentage}%)`);
							});
						} else {
							console.log('   None detected');
						}

						console.log('\n   Low Hours (< 70% of average):');
						if (analysis.hourly.lowHours.length > 0) {
							analysis.hourly.lowHours.forEach((low, i) => {
								const percentage = ((1 - low.power / analysis.overall.averagePower) * 100).toFixed(0);
								console.log(`   ${i + 1}. ${String(low.hour).padStart(2, '0')}:00 - ${low.power.toFixed(0)}W (-${percentage}%)`);
							});
						} else {
							console.log('   None detected');
						}

						// Weekly patterns
						console.log('\n📅 Weekly Patterns:');
						console.log(`   Weekday Average:    ${analysis.weekly.weekdayAverage.toFixed(0)}W`);
						console.log(`   Weekend Average:    ${analysis.weekly.weekendAverage.toFixed(0)}W`);
						const weekDiff = ((analysis.weekly.weekendAverage - analysis.weekly.weekdayAverage) / analysis.weekly.weekdayAverage * 100).toFixed(1);
						console.log(`   Difference:         ${weekDiff > 0 ? '+' : ''}${weekDiff}%\n`);

						// Patterns
						console.log('🔍 Identified Patterns:');
						analysis.patterns.forEach(pattern => {
							const emoji = pattern.includes('peak') ? '📈' :
										  pattern.includes('high') ? '🌙' :
										  pattern.includes('low') ? '💤' : '📊';
							console.log(`   ${emoji} ${pattern.replace(/_/g, ' ')}`);
						});

						if (analysis.note) {
							console.log(`\n⚠️  ${analysis.note}`);
						}

						// Hourly breakdown
						console.log('\n📊 24-Hour Profile (Your Real Consumption):\n');
						console.log('   Hour | Power  | Bar');
						console.log('   -----|--------|' + '─'.repeat(45));

						const maxPower = Math.max(...analysis.hourly.averageByHour.filter(p => p > 0));
						for (let hour = 0; hour < 24; hour++) {
							const power = analysis.hourly.averageByHour[hour];
							const barLength = Math.round((power / maxPower) * 35);
							const bar = power > 0 ? '█'.repeat(barLength) : '';

							let marker = ' ';
							if (power > analysis.overall.averagePower * 1.3) marker = '🔴';
							else if (power < analysis.overall.averagePower * 0.7) marker = '🟢';
							else if (power > analysis.overall.averagePower * 1.1) marker = '🟡';

							console.log(`   ${String(hour).padStart(2, '0')}:00 | ${String(power.toFixed(0)).padStart(6)}W ${marker} | ${bar}`);
						}

						console.log('\n   Legend: 🔴 Peak (>130%)  🟡 High (>110%)  🟢 Low (<70%)\n');

						// AI Prompt
						console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
						console.log('🤖 Data Format for Claude AI:\n');
						console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

						const promptText = analyzer.formatForPrompt(analysis);
						console.log(promptText);

						console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

						console.log('✅ TEST SUCCESSFUL!\n');
						console.log('📝 Summary:');
						console.log(`   • ${analysis.overall.dataPoints} real data points analyzed`);
						console.log(`   • ${daysCovered} days of consumption data`);
						console.log(`   • ${analysis.patterns.length} patterns identified`);
						console.log(`   • ${analysis.hourly.peakHours.length} peak hours detected`);
						console.log(`   • ${analysis.hourly.lowHours.length} low consumption hours detected\n`);

						console.log('💡 What this means:');
						console.log('   ✅ Your history adapter is working correctly');
						console.log('   ✅ Consumption data is being logged properly');
						console.log('   ✅ ConsumptionAnalyzer can process your data');
						console.log('   ✅ This data will be sent to Claude AI for intelligent decisions\n');

						console.log('🚀 Next Steps:');
						console.log('   1. Enable AI Mode in adapter settings');
						console.log('   2. Configure Claude API key and weather service');
						console.log('   3. Set decision time (default 17:30)');
						console.log('   4. Monitor logs for AI decisions\n');

					} catch (error) {
						console.error(`\n❌ Analysis failed: ${error.message}\n`);
						console.error('Stack trace:');
						console.error(error.stack);
					}

					this.terminate();
				});
			},

			unload: function(callback) {
				callback();
			}
		});

	} catch (error) {
		console.error(`\n❌ Failed to initialize: ${error.message}\n`);

		if (error.message.includes('adapter-core')) {
			console.log('💡 This script must be run from your ioBroker installation directory!\n');
			console.log('🔧 Usage:');
			console.log('   $ cd /opt/iobroker  # or your ioBroker directory');
			console.log('   $ node /home/trammer/ioBroker.calamari/test-real-history.js\n');
		}

		process.exit(1);
	}
}

// Check if we're in ioBroker directory
const fs = require('fs');
const path = require('path');

if (!fs.existsSync('./iobroker.js') && !fs.existsSync('../iobroker.js')) {
	console.error('❌ Not in ioBroker directory!\n');
	console.log('💡 Please run this script from your ioBroker installation:\n');
	console.log('   $ cd /opt/iobroker  # or your ioBroker directory');
	console.log('   $ node /home/trammer/ioBroker.calamari/test-real-history.js\n');
	process.exit(1);
}

testRealHistory();
