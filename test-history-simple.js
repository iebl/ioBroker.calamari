/**
 * Simple History Data Test Script
 *
 * This script directly queries the history adapter without using the full adapter framework.
 * Run this in the ioBroker directory or adjust the paths accordingly.
 *
 * Usage:
 *   node test-history-simple.js
 */

// Configuration - ADJUST THESE TO YOUR SETUP
const CONFIG = {
	historyInstance: 'sql.0',              // Your history adapter instance
	evccPowerState: 'evcc.0.status.homePower',  // State to query
	days: 7                                 // Number of days to analyze
};

console.log('═══════════════════════════════════════════════════════════');
console.log('  🧪 Simple History Data Test');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('📋 Configuration:');
console.log(`   History Instance: ${CONFIG.historyInstance}`);
console.log(`   State: ${CONFIG.evccPowerState}`);
console.log(`   Days: ${CONFIG.days}`);
console.log('');

async function testHistory() {
	try {
		// Load ioBroker adapter core
		const adapterCore = require('@iobroker/adapter-core');

		// Create temporary adapter for testing
		const adapter = adapterCore.adapter({
			name: 'test',
			useFormatDate: true,

			ready: async function() {
				console.log('✅ Adapter ready, querying history...\n');

				const end = new Date();
				const start = new Date(end.getTime() - CONFIG.days * 24 * 60 * 60 * 1000);

				console.log(`📅 Query Range:`);
				console.log(`   From: ${start.toISOString()}`);
				console.log(`   To:   ${end.toISOString()}`);
				console.log('');

				const message = {
					id: CONFIG.evccPowerState,
					options: {
						start: start.getTime(),
						end: end.getTime(),
						aggregate: 'average',
						step: 900000  // 15 minutes in milliseconds
					}
				};

				console.log('📡 Sending query to history adapter...');
				console.log(`   Target: ${CONFIG.historyInstance}`);
				console.log(`   State: ${message.id}`);
				console.log(`   Aggregation: ${message.options.aggregate}, Step: ${message.options.step / 60000} min`);
				console.log('');

				this.sendTo(CONFIG.historyInstance, 'getHistory', message, (result) => {
					console.log('📨 Response received!\n');

					if (result.error) {
						console.error(`❌ Error: ${result.error}`);
						console.log('\n💡 Troubleshooting:');
						console.log(`   1. Check if ${CONFIG.historyInstance} is running`);
						console.log(`   2. Check if state ${CONFIG.evccPowerState} exists`);
						console.log(`   3. Check if state is being logged in history adapter`);
						this.terminate();
						return;
					}

					if (!result.result || result.result.length === 0) {
						console.warn('⚠️  No data returned!');
						console.log('\n💡 Possible reasons:');
						console.log(`   1. State ${CONFIG.evccPowerState} is not being logged`);
						console.log('   2. Not enough data collected yet (need at least some data)');
						console.log('   3. State path is incorrect');
						this.terminate();
						return;
					}

					const data = result.result;
					console.log(`✅ Data received: ${data.length} data points\n`);

					// Analyze data
					console.log('═══════════════════════════════════════════════════════════');
					console.log('  📊 DATA ANALYSIS');
					console.log('═══════════════════════════════════════════════════════════\n');

					// Sample data
					console.log('📋 First 10 data points:');
					console.log('   #  | Timestamp                | Value');
					console.log('   ---|--------------------------|-------------');
					data.slice(0, 10).forEach((point, index) => {
						const date = new Date(point.ts);
						const dateStr = date.toISOString().replace('T', ' ').substring(0, 19);
						console.log(`   ${String(index + 1).padStart(2)} | ${dateStr} | ${point.val}W`);
					});

					// Date range
					const firstDate = new Date(data[0].ts);
					const lastDate = new Date(data[data.length - 1].ts);
					const daysDiff = ((lastDate - firstDate) / (1000 * 60 * 60 * 24)).toFixed(1);

					console.log('\n📅 Data Coverage:');
					console.log(`   First: ${firstDate.toISOString()}`);
					console.log(`   Last:  ${lastDate.toISOString()}`);
					console.log(`   Span:  ${daysDiff} days`);
					console.log(`   Points: ${data.length}`);

					// Calculate statistics
					const values = data.map(p => Math.abs(p.val || 0));
					const sum = values.reduce((a, b) => a + b, 0);
					const avg = sum / values.length;
					const max = Math.max(...values);
					const min = Math.min(...values.filter(v => v > 0));

					console.log('\n📈 Statistics:');
					console.log(`   Average: ${avg.toFixed(0)}W`);
					console.log(`   Maximum: ${max.toFixed(0)}W`);
					console.log(`   Minimum: ${min.toFixed(0)}W`);
					console.log(`   Total: ${sum.toFixed(0)}Wh`);
					console.log(`   Daily Avg: ${(avg * 24 / 1000).toFixed(2)} kWh`);

					// Hourly breakdown
					const hourlyData = new Array(24).fill(0);
					const hourlyCounts = new Array(24).fill(0);

					data.forEach(point => {
						const hour = new Date(point.ts).getHours();
						hourlyData[hour] += Math.abs(point.val || 0);
						hourlyCounts[hour]++;
					});

					for (let i = 0; i < 24; i++) {
						if (hourlyCounts[i] > 0) {
							hourlyData[i] = hourlyData[i] / hourlyCounts[i];
						}
					}

					console.log('\n⏰ Hourly Average (24h):');
					console.log('   Hour | Power  | Samples | Bar');
					console.log('   -----|--------|---------|' + '─'.repeat(35));
					const maxHourly = Math.max(...hourlyData);
					for (let hour = 0; hour < 24; hour++) {
						const power = hourlyData[hour];
						const count = hourlyCounts[hour];
						const barLength = Math.round((power / maxHourly) * 25);
						const bar = '█'.repeat(barLength);
						console.log(`   ${String(hour).padStart(2, '0')}:00 | ${String(power.toFixed(0)).padStart(6)}W | ${String(count).padStart(7)} | ${bar}`);
					}

					// Find peaks
					const peaks = [];
					for (let i = 0; i < 24; i++) {
						if (hourlyData[i] > avg * 1.2) {
							peaks.push({ hour: i, power: hourlyData[i] });
						}
					}
					peaks.sort((a, b) => b.power - a.power);

					console.log('\n🔝 Peak Hours (> 120% of average):');
					if (peaks.length > 0) {
						peaks.slice(0, 5).forEach((peak, index) => {
							console.log(`   ${index + 1}. ${String(peak.hour).padStart(2, '0')}:00 - ${peak.power.toFixed(0)}W`);
						});
					} else {
						console.log('   No significant peaks detected');
					}

					console.log('\n✅ History data is working correctly!');
					console.log('\n💡 Next steps:');
					console.log('   1. This data will be used by the AI Mode for consumption analysis');
					console.log('   2. The ConsumptionAnalyzer will identify patterns (morning peak, evening peak, etc.)');
					console.log('   3. Claude AI will use these patterns for intelligent charging decisions');

					this.terminate();
				});
			},

			unload: function(callback) {
				callback();
			}
		});

	} catch (error) {
		console.error('\n❌ Error:', error.message);
		console.error('\nStack trace:');
		console.error(error.stack);
		console.log('\n💡 Make sure you run this script from the ioBroker installation directory');
		console.log('   or set NODE_PATH to include ioBroker node_modules');
		process.exit(1);
	}
}

// Run test
testHistory();
