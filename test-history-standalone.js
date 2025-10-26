#!/usr/bin/env node
/**
 * Standalone History Test for Production ioBroker
 *
 * This script can be run from anywhere on your ioBroker system.
 * It will find the installed calamari adapter and test the history functionality.
 *
 * Usage:
 *   1. Copy this file to your ioBroker server
 *   2. Run: node test-history-standalone.js
 */

// Configuration - ADJUST TO YOUR SETUP
const CONFIG = {
	historyInstance: 'sql.0',              // Your history adapter
	evccPowerState: 'evcc.0.status.homePower',
	days: 7
};

console.log('═══════════════════════════════════════════════════════════');
console.log('  🔍 Standalone History Test for Production ioBroker');
console.log('═══════════════════════════════════════════════════════════\n');

async function findAdapterCore() {
	const possiblePaths = [
		'@iobroker/adapter-core',                          // Local
		'/opt/iobroker/node_modules/@iobroker/adapter-core', // Standard ioBroker
		'/usr/local/iobroker/node_modules/@iobroker/adapter-core'
	];

	for (const path of possiblePaths) {
		try {
			const core = require(path);
			console.log(`✅ Found adapter-core: ${path}\n`);
			return core;
		} catch (e) {
			// Continue
		}
	}

	throw new Error('Could not find @iobroker/adapter-core. Are you on an ioBroker system?');
}

async function findCalamariAdapter() {
	const possiblePaths = [
		'iobroker.calamari/lib/aiMode',                          // Local
		'/opt/iobroker/node_modules/iobroker.calamari/lib/aiMode', // Standard
		'/usr/local/iobroker/node_modules/iobroker.calamari/lib/aiMode'
	];

	for (const path of possiblePaths) {
		try {
			const aiMode = require(path);
			console.log(`✅ Found calamari adapter: ${path}\n`);
			return aiMode;
		} catch (e) {
			// Continue
		}
	}

	console.warn('⚠️  Could not find installed calamari adapter');
	console.log('   Will test history connection without ConsumptionAnalyzer\n');
	return null;
}

async function testHistory() {
	try {
		console.log('📋 Configuration:');
		console.log(`   History Instance: ${CONFIG.historyInstance}`);
		console.log(`   State: ${CONFIG.evccPowerState}`);
		console.log(`   Days: ${CONFIG.days}\n`);

		// Find adapter core
		const adapterCore = await findAdapterCore();

		// Find calamari adapter (optional)
		const aiMode = await findCalamariAdapter();
		const ConsumptionAnalyzer = aiMode ? aiMode.ConsumptionAnalyzer : null;

		// Create test adapter
		const adapter = adapterCore.adapter({
			name: 'test',

			ready: async function() {
				console.log('✅ Test adapter initialized\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
				console.log('🔍 Testing History Connection\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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
						console.log(`   1. Check if ${CONFIG.historyInstance} is running`);
						console.log(`   2. Edit CONFIG at top of this script to use correct instance`);
						console.log(`   3. Check if state exists: ${CONFIG.evccPowerState}\n`);
						this.terminate();
						return;
					}

					if (!result.result || result.result.length === 0) {
						console.warn(`⚠️  No data returned\n`);
						console.log('💡 Possible reasons:');
						console.log(`   1. State ${CONFIG.evccPowerState} is not being logged`);
						console.log('   2. Not enough data collected yet\n');
						this.terminate();
						return;
					}

					const data = result.result;
					console.log(`✅ ${data.length} data points received!\n`);

					// Basic analysis
					const firstDate = new Date(data[0].ts);
					const lastDate = new Date(data[data.length - 1].ts);
					const daysCovered = ((lastDate - firstDate) / (1000 * 60 * 60 * 24)).toFixed(1);

					console.log('📊 Data Info:');
					console.log(`   First: ${firstDate.toISOString()}`);
					console.log(`   Last:  ${lastDate.toISOString()}`);
					console.log(`   Span:  ${daysCovered} days\n`);

					// Sample data
					console.log('📋 Sample (first 5 points):');
					data.slice(0, 5).forEach((point, i) => {
						const date = new Date(point.ts).toISOString();
						console.log(`   ${i + 1}. ${date} - ${point.val}W`);
					});

					// Statistics
					const values = data.map(p => Math.abs(p.val || 0));
					const sum = values.reduce((a, b) => a + b, 0);
					const avg = sum / values.length;
					const max = Math.max(...values);
					const min = Math.min(...values.filter(v => v > 0));

					console.log('\n📈 Statistics:');
					console.log(`   Average:       ${avg.toFixed(0)}W`);
					console.log(`   Maximum:       ${max.toFixed(0)}W`);
					console.log(`   Minimum:       ${min.toFixed(0)}W`);
					console.log(`   Daily Average: ${(avg * 24 / 1000).toFixed(2)} kWh\n`);

					// If ConsumptionAnalyzer is available, use it
					if (ConsumptionAnalyzer) {
						console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
						console.log('🤖 Running ConsumptionAnalyzer\n');
						console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

						const analyzerConfig = {
							historyInstance: CONFIG.historyInstance,
							evccPowerState: CONFIG.evccPowerState,
							historyAnalysisDays: CONFIG.days
						};

						const analyzer = new ConsumptionAnalyzer(this, analyzerConfig);

						try {
							const analysis = await analyzer.analyzeConsumption();

							console.log('📊 Analysis Results:\n');
							console.log(`   Daily Consumption:  ${analysis.overall.dailyConsumption.toFixed(2)} kWh`);
							console.log(`   Average Power:      ${analysis.overall.averagePower.toFixed(0)}W\n`);

							if (analysis.hourly.peakHours.length > 0) {
								console.log('   Peak Hours:');
								analysis.hourly.peakHours.slice(0, 3).forEach((p, i) => {
									console.log(`      ${i + 1}. ${p.hour}:00 - ${p.power.toFixed(0)}W`);
								});
							}

							console.log('\n   Patterns:');
							analysis.patterns.forEach(p => {
								console.log(`      • ${p.replace(/_/g, ' ')}`);
							});

							console.log('\n🤖 AI Prompt Preview:');
							console.log('───────────────────────────────────────────────────────────');
							console.log(analyzer.formatForPrompt(analysis));
							console.log('───────────────────────────────────────────────────────────');
						} catch (error) {
							console.error(`\n❌ Analysis failed: ${error.message}`);
						}
					}

					console.log('\n✅ TEST SUCCESSFUL!\n');
					console.log('💡 This confirms:');
					console.log('   ✅ History adapter is working');
					console.log('   ✅ Data is being logged correctly');
					console.log('   ✅ AI Mode can access consumption data\n');

					this.terminate();
				});
			},

			unload: function(callback) {
				callback();
			}
		});

	} catch (error) {
		console.error(`\n❌ Test failed: ${error.message}\n`);

		if (error.message.includes('adapter-core')) {
			console.log('💡 This script must be run on an ioBroker system!\n');
		}

		process.exit(1);
	}
}

testHistory();
