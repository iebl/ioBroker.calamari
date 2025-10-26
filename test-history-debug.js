#!/usr/bin/env node
/**
 * Debug Version - History Test with detailed logging
 */

const CONFIG = {
	historyInstance: 'sql.0',
	evccPowerState: 'evcc.0.status.homePower',
	days: 7
};

console.log('═══════════════════════════════════════════════════════════');
console.log('  🐛 Debug Mode - History Test');
console.log('═══════════════════════════════════════════════════════════\n');

const path = require('path');

console.log('🔍 Step 1: Finding adapter-core...');
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
			console.log(`   ✅ Found at: ${p}\n`);
			return core;
		} catch (e) {
			console.log(`   ❌ Not at: ${p}`);
		}
	}

	throw new Error('Could not find adapter-core');
}

console.log('🔍 Step 2: Finding calamari adapter...');
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
			console.log(`   ✅ Found at: ${p}\n`);
			return aiMode.ConsumptionAnalyzer;
		} catch (e) {
			console.log(`   ❌ Not at: ${p}`);
		}
	}

	console.log('   ⚠️  Not found - will skip analysis\n');
	return null;
}

async function runTest() {
	try {
		const adapterCore = findAdapterCore();
		const ConsumptionAnalyzer = findCalamariAdapter();

		console.log('🔍 Step 3: Creating test adapter...');

		// Add process handlers
		process.on('exit', (code) => {
			console.log(`\n🚪 Process exiting with code: ${code}`);
		});

		process.on('uncaughtException', (error) => {
			console.error(`\n💥 Uncaught exception: ${error.message}`);
			console.error(error.stack);
			process.exit(1);
		});

		const adapter = adapterCore.adapter({
			name: 'test',

			ready: function() {
				console.log('   ✅ Adapter ready() called\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
				console.log('  🔍 Querying History Adapter');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

				console.log(`📋 Config: ${CONFIG.historyInstance} / ${CONFIG.evccPowerState}`);

				const end = new Date();
				const start = new Date(end.getTime() - CONFIG.days * 24 * 60 * 60 * 1000);

				console.log(`📅 From: ${start.toISOString()}`);
				console.log(`📅 To:   ${end.toISOString()}\n`);

				console.log('📡 Sending query...');

				this.sendTo(CONFIG.historyInstance, 'getHistory', {
					id: CONFIG.evccPowerState,
					options: {
						start: start.getTime(),
						end: end.getTime(),
						aggregate: 'average',
						step: 900000
					}
				}, (result) => {
					console.log('\n📨 Response received!\n');

					if (result.error) {
						console.error(`❌ Error: ${result.error}\n`);
						this.terminate();
						return;
					}

					if (!result.result || result.result.length === 0) {
						console.warn('⚠️  No data returned\n');
						this.terminate();
						return;
					}

					console.log(`✅ ${result.result.length} data points received\n`);

					// Show first few points
					console.log('Sample data:');
					result.result.slice(0, 3).forEach((p, i) => {
						console.log(`   ${i + 1}. ${new Date(p.ts).toISOString()} - ${p.val}W`);
					});

					console.log('\n✅ History test successful!\n');

					this.terminate();
				});
			},

			unload: function(callback) {
				console.log('🔄 Adapter unload() called');
				callback();
			}
		});

		console.log('   ✅ Adapter object created\n');
		console.log('⏳ Waiting for adapter to initialize...\n');

		// Keep process alive
		setTimeout(() => {
			console.log('⏰ Timeout reached - if you see this, the adapter never called ready()');
			process.exit(1);
		}, 30000);

	} catch (error) {
		console.error(`\n💥 Error: ${error.message}`);
		console.error(error.stack);
		process.exit(1);
	}
}

runTest();
