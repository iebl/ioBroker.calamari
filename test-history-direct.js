/**
 * Direct History Test - Works without full ioBroker context
 *
 * This creates a minimal test to check if history data can be accessed
 */

// Configuration
const CONFIG = {
	historyInstance: 'sql.0',
	evccPowerState: 'evcc.0.status.homePower',
	days: 7
};

console.log('═══════════════════════════════════════════════════════════');
console.log('  🧪 History Data Test (Direct Mode)');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('📋 Configuration:');
console.log(`   History Instance: ${CONFIG.historyInstance}`);
console.log(`   State: ${CONFIG.evccPowerState}`);
console.log(`   Days: ${CONFIG.days}\n`);

async function testHistoryDirect() {
	try {
		// Try to load adapter-core from ioBroker installation
		let adapterCore;
		try {
			// Try local first
			adapterCore = require('@iobroker/adapter-core');
		} catch (e) {
			// Try global ioBroker installation
			const paths = [
				'/opt/iobroker/node_modules/@iobroker/adapter-core',
				'/usr/lib/node_modules/iobroker/node_modules/@iobroker/adapter-core',
				'../../@iobroker/adapter-core'
			];

			for (const path of paths) {
				try {
					adapterCore = require(path);
					console.log(`✅ Found adapter-core at: ${path}\n`);
					break;
				} catch (err) {
					// Continue
				}
			}

			if (!adapterCore) {
				throw new Error('Could not find @iobroker/adapter-core');
			}
		}

		// Create test adapter
		const adapter = adapterCore.adapter({
			name: 'calamari',

			ready: async function() {
				console.log('✅ Adapter ready!\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
				console.log('🔍 Querying History Adapter\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

				const end = new Date();
				const start = new Date(end.getTime() - CONFIG.days * 24 * 60 * 60 * 1000);

				console.log(`📅 Query Range:`);
				console.log(`   From: ${start.toISOString()}`);
				console.log(`   To:   ${end.toISOString()}\n`);

				const message = {
					id: CONFIG.evccPowerState,
					options: {
						start: start.getTime(),
						end: end.getTime(),
						aggregate: 'average',
						step: 900000  // 15 minutes
					}
				};

				console.log('📡 Sending query...\n');

				this.sendTo(CONFIG.historyInstance, 'getHistory', message, (result) => {
					console.log('📨 Response received!\n');

					if (result.error) {
						console.error(`❌ ERROR: ${result.error}\n`);
						console.log('💡 Troubleshooting:');
						console.log(`   1. Check if ${CONFIG.historyInstance} is running:`);
						console.log(`      $ iobroker status ${CONFIG.historyInstance}`);
						console.log(`   2. Try different instance names: history.0, sql.0, influxdb.0`);
						console.log(`   3. Check if state exists: ${CONFIG.evccPowerState}`);
						console.log(`   4. Check if state is being logged\n`);
						this.terminate();
						return;
					}

					if (!result.result || result.result.length === 0) {
						console.warn('⚠️  No data returned!\n');
						console.log('💡 Possible reasons:');
						console.log(`   1. State ${CONFIG.evccPowerState} is not being logged`);
						console.log('   2. Not enough historical data collected yet');
						console.log('   3. State path is incorrect\n');
						console.log('🔧 To fix:');
						console.log(`   1. Go to Admin → Objects → ${CONFIG.evccPowerState}`);
						console.log('   2. Click the settings icon');
						console.log('   3. Enable logging in history adapter');
						console.log('   4. Wait for data to be collected\n');
						this.terminate();
						return;
					}

					const data = result.result;

					console.log('═══════════════════════════════════════════════════════════');
					console.log('  ✅ SUCCESS - History Data Available!');
					console.log('═══════════════════════════════════════════════════════════\n');

					console.log(`📊 ${data.length} data points received\n`);

					// Basic analysis
					const firstDate = new Date(data[0].ts);
					const lastDate = new Date(data[data.length - 1].ts);
					const daysCovered = ((lastDate - firstDate) / (1000 * 60 * 60 * 24)).toFixed(1);

					console.log('📅 Data Coverage:');
					console.log(`   First: ${firstDate.toISOString()}`);
					console.log(`   Last:  ${lastDate.toISOString()}`);
					console.log(`   Span:  ${daysCovered} days\n`);

					// Sample data
					console.log('📋 Sample Data (first 10 points):');
					console.log('   #  | Timestamp                | Value');
					console.log('   ---|--------------------------|-------------');
					data.slice(0, 10).forEach((point, i) => {
						const date = new Date(point.ts).toISOString().replace('T', ' ').substring(0, 19);
						console.log(`   ${String(i + 1).padStart(2)} | ${date} | ${point.val}W`);
					});

					// Statistics
					const values = data.map(p => Math.abs(p.val || 0));
					const sum = values.reduce((a, b) => a + b, 0);
					const avg = sum / values.length;
					const max = Math.max(...values);
					const min = Math.min(...values.filter(v => v > 0));

					console.log('\n📈 Quick Statistics:');
					console.log(`   Average:       ${avg.toFixed(0)}W`);
					console.log(`   Maximum:       ${max.toFixed(0)}W`);
					console.log(`   Minimum:       ${min.toFixed(0)}W`);
					console.log(`   Daily Average: ${(avg * 24 / 1000).toFixed(2)} kWh\n`);

					console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
					console.log('✅ TEST PASSED!\n');
					console.log('💡 Next Steps:');
					console.log('   1. History data is working correctly');
					console.log('   2. The ConsumptionAnalyzer will use this data');
					console.log('   3. Claude AI will receive consumption patterns for better decisions');
					console.log('   4. Enable AI Mode in adapter settings to use this feature\n');

					this.terminate();
				});
			},

			unload: function(callback) {
				callback();
			}
		});

	} catch (error) {
		console.error('\n❌ Failed to initialize test:\n');
		console.error(`   ${error.message}\n`);

		if (error.message.includes('adapter-core')) {
			console.log('💡 This test needs to run in an ioBroker environment.\n');
			console.log('🔧 Options:');
			console.log('   1. Install the adapter first:');
			console.log('      $ cd /opt/iobroker');
			console.log('      $ iobroker install /path/to/ioBroker.calamari');
			console.log('   2. Or test after publishing to npm\n');
		}

		process.exit(1);
	}
}

testHistoryDirect();
