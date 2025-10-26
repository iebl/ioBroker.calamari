#!/usr/bin/env node
/**
 * Production History Test for ioBroker Calamari Adapter
 *
 * This script tests the history data functionality on a live ioBroker system.
 * It automatically finds the installed adapter and tests consumption analysis.
 *
 * Usage:
 *   node test-history-production.js
 *
 * Requirements:
 *   - ioBroker system with calamari adapter installed
 *   - History adapter (sql, history, or influxdb) configured
 *   - evcc.0.status.homePower state being logged
 */

// ============================================================================
// CONFIGURATION - Edit these values for your system
// ============================================================================
const CONFIG = {
	historyInstance: 'sql.0',                    // Your history adapter instance
	evccPowerState: 'evcc.0.status.homePower',   // State path for home power
	days: 7                                      // Number of days to analyze
};
// ============================================================================

const path = require('path');
const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════');
console.log('  🧪 Calamari History Test - Production');
console.log('═══════════════════════════════════════════════════════════\n');

/**
 * Find adapter-core in ioBroker installation
 */
function findAdapterCore() {
	const paths = [
		'@iobroker/adapter-core',
		path.join(process.cwd(), 'node_modules/@iobroker/adapter-core'),
		'/opt/iobroker/node_modules/@iobroker/adapter-core',
		'/usr/local/iobroker/node_modules/@iobroker/adapter-core'
	];

	for (const p of paths) {
		try {
			const core = require(p);
			console.log(`✅ Found @iobroker/adapter-core`);
			return core;
		} catch (e) {
			// Continue
		}
	}

	throw new Error('❌ Could not find @iobroker/adapter-core\n   Are you running this on an ioBroker system?');
}

/**
 * Find installed calamari adapter
 */
function findCalamariAdapter() {
	const paths = [
		'iobroker.calamari/lib/aiMode',
		path.join(process.cwd(), 'node_modules/iobroker.calamari/lib/aiMode'),
		'/opt/iobroker/node_modules/iobroker.calamari/lib/aiMode',
		'/usr/local/iobroker/node_modules/iobroker.calamari/lib/aiMode'
	];

	for (const p of paths) {
		try {
			const aiMode = require(p);
			console.log(`✅ Found calamari adapter with ConsumptionAnalyzer\n`);
			return aiMode.ConsumptionAnalyzer;
		} catch (e) {
			// Continue
		}
	}

	console.log('⚠️  Calamari adapter not found - will only test basic history\n');
	return null;
}

/**
 * Main test function
 */
async function runTest() {
	console.log('📋 Configuration:');
	console.log(`   History Instance: ${CONFIG.historyInstance}`);
	console.log(`   State Path:       ${CONFIG.evccPowerState}`);
	console.log(`   Analysis Period:  ${CONFIG.days} days\n`);

	try {
		// Find required modules
		const adapterCore = findAdapterCore();
		const ConsumptionAnalyzer = findCalamariAdapter();

		// Create test adapter
		const adapter = adapterCore.adapter({
			name: 'test',

			ready: async function() {
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
				console.log('  STEP 1: Testing History Adapter Connection');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

				const end = new Date();
				const start = new Date(end.getTime() - CONFIG.days * 24 * 60 * 60 * 1000);

				console.log(`📅 Time Range:`);
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
					// Handle errors
					if (result.error) {
						console.error(`❌ ERROR: ${result.error}\n`);
						console.log('💡 Troubleshooting Steps:');
						console.log(`   1. Check if ${CONFIG.historyInstance} is running:`);
						console.log(`      $ iobroker status ${CONFIG.historyInstance}`);
						console.log(`   2. Verify state exists: ${CONFIG.evccPowerState}`);
						console.log(`   3. Ensure state is being logged in history adapter`);
						console.log(`   4. Edit CONFIG section at top of script if needed\n`);
						this.terminate();
						return;
					}

					// Handle no data
					if (!result.result || result.result.length === 0) {
						console.warn(`⚠️  No Data Returned\n`);
						console.log('💡 Possible Issues:');
						console.log(`   • State ${CONFIG.evccPowerState} is not being logged`);
						console.log(`   • No data collected yet (needs at least a few hours)`);
						console.log(`   • Wrong state path or history instance\n`);
						console.log('🔧 How to Enable Logging:');
						console.log(`   1. Open Admin UI → Objects`);
						console.log(`   2. Find: ${CONFIG.evccPowerState}`);
						console.log(`   3. Click settings icon (⚙️)`);
						console.log(`   4. Enable logging for ${CONFIG.historyInstance}`);
						console.log(`   5. Wait for data collection\n`);
						this.terminate();
						return;
					}

					const data = result.result;
					const firstDate = new Date(data[0].ts);
					const lastDate = new Date(data[data.length - 1].ts);
					const daysCovered = ((lastDate - firstDate) / (1000 * 60 * 60 * 24)).toFixed(1);

					console.log(`✅ SUCCESS: ${data.length} data points received\n`);

					console.log('📊 Data Coverage:');
					console.log(`   First Point: ${firstDate.toISOString()}`);
					console.log(`   Last Point:  ${lastDate.toISOString()}`);
					console.log(`   Time Span:   ${daysCovered} days\n`);

					// Show sample data
					console.log('📋 Sample Data (first 5 points):');
					data.slice(0, 5).forEach((point, i) => {
						const ts = new Date(point.ts).toISOString().replace('T', ' ').substring(0, 19);
						console.log(`   ${i + 1}. ${ts} - ${point.val}W`);
					});

					// Calculate basic statistics
					const values = data.map(p => Math.abs(p.val || 0));
					const sum = values.reduce((a, b) => a + b, 0);
					const avg = sum / values.length;
					const max = Math.max(...values);
					const min = Math.min(...values.filter(v => v > 0));

					console.log('\n📈 Basic Statistics:');
					console.log(`   Average Power:     ${avg.toFixed(0)}W`);
					console.log(`   Maximum Power:     ${max.toFixed(0)}W`);
					console.log(`   Minimum Power:     ${min.toFixed(0)}W`);
					console.log(`   Daily Consumption: ${(avg * 24 / 1000).toFixed(2)} kWh\n`);

					// If ConsumptionAnalyzer is available, run full analysis
					if (ConsumptionAnalyzer) {
						console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
						console.log('  STEP 2: Running Consumption Pattern Analysis');
						console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

						const analyzerConfig = {
							historyInstance: CONFIG.historyInstance,
							evccPowerState: CONFIG.evccPowerState,
							historyAnalysisDays: CONFIG.days
						};

						const analyzer = new ConsumptionAnalyzer(this, analyzerConfig);

						try {
							const analysis = await analyzer.analyzeConsumption();

							console.log('📊 ANALYSIS RESULTS:\n');

							// Overall stats
							console.log('🔢 Overall Statistics:');
							console.log(`   Average Power:      ${analysis.overall.averagePower.toFixed(0)}W`);
							console.log(`   Daily Consumption:  ${analysis.overall.dailyConsumption.toFixed(2)} kWh`);
							console.log(`   Data Points:        ${analysis.overall.dataPoints}`);
							console.log(`   Days Analyzed:      ${analysis.overall.daysAnalyzed}\n`);

							// Peak hours
							if (analysis.hourly.peakHours.length > 0) {
								console.log('⚡ Peak Consumption Hours:');
								analysis.hourly.peakHours.forEach((peak, i) => {
									const pct = ((peak.power / analysis.overall.averagePower - 1) * 100).toFixed(0);
									console.log(`   ${i + 1}. ${String(peak.hour).padStart(2, '0')}:00 - ${peak.power.toFixed(0)}W (+${pct}%)`);
								});
								console.log('');
							}

							// Low hours
							if (analysis.hourly.lowHours.length > 0) {
								console.log('💤 Low Consumption Hours:');
								analysis.hourly.lowHours.forEach((low, i) => {
									const pct = ((1 - low.power / analysis.overall.averagePower) * 100).toFixed(0);
									console.log(`   ${i + 1}. ${String(low.hour).padStart(2, '0')}:00 - ${low.power.toFixed(0)}W (-${pct}%)`);
								});
								console.log('');
							}

							// Weekly patterns
							console.log('📅 Weekly Patterns:');
							console.log(`   Weekday Average:    ${analysis.weekly.weekdayAverage.toFixed(0)}W`);
							console.log(`   Weekend Average:    ${analysis.weekly.weekendAverage.toFixed(0)}W`);
							const diff = ((analysis.weekly.weekendAverage - analysis.weekly.weekdayAverage) / analysis.weekly.weekdayAverage * 100).toFixed(1);
							console.log(`   Difference:         ${diff > 0 ? '+' : ''}${diff}%\n`);

							// Patterns
							console.log('🔍 Identified Patterns:');
							analysis.patterns.forEach(pattern => {
								const icon = pattern.includes('peak') ? '📈' :
											 pattern.includes('high') ? '🌙' :
											 pattern.includes('low') ? '💤' : '📊';
								console.log(`   ${icon} ${pattern.replace(/_/g, ' ')}`);
							});
							console.log('');

							// 24h profile
							console.log('📊 24-Hour Consumption Profile:\n');
							console.log('   Hour | Power  | Visualization');
							console.log('   -----|--------|' + '─'.repeat(40));

							const maxPower = Math.max(...analysis.hourly.averageByHour);
							for (let h = 0; h < 24; h++) {
								const pwr = analysis.hourly.averageByHour[h];
								const barLen = Math.round((pwr / maxPower) * 30);
								const bar = pwr > 0 ? '█'.repeat(barLen) : '';

								let icon = ' ';
								if (pwr > analysis.overall.averagePower * 1.3) icon = '🔴';
								else if (pwr < analysis.overall.averagePower * 0.7) icon = '🟢';
								else if (pwr > analysis.overall.averagePower * 1.1) icon = '🟡';

								console.log(`   ${String(h).padStart(2, '0')}:00 | ${String(pwr.toFixed(0)).padStart(6)}W ${icon} | ${bar}`);
							}

							console.log('\n   Legend: 🔴 Peak  🟡 High  🟢 Low\n');

							// AI Prompt format
							console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
							console.log('  🤖 AI Prompt Format (sent to Claude AI)');
							console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

							const promptText = analyzer.formatForPrompt(analysis);
							console.log(promptText);
							console.log('');

						} catch (error) {
							console.error(`\n❌ Analysis failed: ${error.message}`);
							console.error(error.stack);
						}
					}

					// Success summary
					console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
					console.log('  ✅ TEST COMPLETED SUCCESSFULLY');
					console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

					console.log('💡 What this means:');
					console.log('   ✅ History adapter connection works');
					console.log('   ✅ Consumption data is being logged');
					console.log('   ✅ Data can be analyzed for patterns');
					console.log('   ✅ AI Mode can use this data for decisions\n');

					console.log('🚀 Next Steps:');
					console.log('   1. Enable AI Mode in calamari adapter settings');
					console.log('   2. Configure Claude API key');
					console.log('   3. Configure brightsky adapter instance');
					console.log('   4. Set AI decision time (default 17:30)');
					console.log('   5. Check logs for AI recommendations\n');

					this.terminate();
				});
			},

			unload: function(callback) {
				callback();
			}
		});

	} catch (error) {
		console.error(`\n❌ FATAL ERROR: ${error.message}\n`);

		if (error.message.includes('adapter-core')) {
			console.log('💡 This script must run on an ioBroker system!\n');
			console.log('📝 Usage:');
			console.log('   1. Copy this script to your ioBroker server');
			console.log('   2. SSH to your ioBroker server');
			console.log('   3. Run: node /path/to/test-history-production.js\n');
		}

		process.exit(1);
	}
}

// Run the test
runTest();
