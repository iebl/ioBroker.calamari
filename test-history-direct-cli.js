#!/usr/bin/env node
/**
 * Direct CLI History Test - Uses iobroker CLI directly
 *
 * This bypasses the adapter framework and uses the iobroker command
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const CONFIG = {
	historyInstance: 'sql.0',
	evccPowerState: 'evcc.0.status.homePower',
	days: 7
};

console.log('═══════════════════════════════════════════════════════════');
console.log('  🔍 Direct CLI History Test');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('📋 Configuration:');
console.log(`   History Instance: ${CONFIG.historyInstance}`);
console.log(`   State Path:       ${CONFIG.evccPowerState}`);
console.log(`   Days:             ${CONFIG.days}\n`);

async function checkHistoryAdapter() {
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log('  STEP 1: Check History Adapter Status');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	try {
		const { stdout } = await execPromise(`iobroker status ${CONFIG.historyInstance}`);
		console.log(`✅ ${CONFIG.historyInstance} status:`);
		console.log(stdout);
	} catch (error) {
		console.error(`❌ Failed to check status: ${error.message}\n`);
	}
}

async function checkStateExists() {
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log('  STEP 2: Check if State Exists');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	try {
		const { stdout } = await execPromise(`iobroker state get ${CONFIG.evccPowerState}`);
		console.log(`✅ State ${CONFIG.evccPowerState}:`);
		console.log(stdout);
	} catch (error) {
		console.error(`❌ State not found or error: ${error.message}\n`);
	}
}

async function testConsumptionAnalyzer() {
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log('  STEP 3: Load ConsumptionAnalyzer Directly');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	try {
		// Try to load the module directly
		const aiModePath = '/opt/iobroker/node_modules/iobroker.calamari/lib/aiMode.js';
		const { ConsumptionAnalyzer } = require(aiModePath);

		console.log('✅ ConsumptionAnalyzer loaded successfully\n');
		console.log('📊 Module info:');
		console.log(`   Path: ${aiModePath}`);
		console.log(`   Type: ${typeof ConsumptionAnalyzer}`);
		console.log(`   Constructor: ${ConsumptionAnalyzer.name}\n`);

		// Show what methods are available
		console.log('📋 Available methods:');
		const methods = Object.getOwnPropertyNames(ConsumptionAnalyzer.prototype).filter(m => m !== 'constructor');
		methods.forEach(method => {
			console.log(`   • ${method}()`);
		});
		console.log('');

		return ConsumptionAnalyzer;
	} catch (error) {
		console.error(`❌ Failed to load ConsumptionAnalyzer: ${error.message}\n`);
		return null;
	}
}

async function suggestNextSteps() {
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log('  💡 Recommendations');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	console.log('To test the history functionality properly, you have these options:\n');

	console.log('📝 Option 1: Enable AI Mode in the adapter');
	console.log('   1. Open Admin UI → Instances → calamari');
	console.log('   2. Configure settings');
	console.log('   3. Enable AI Mode');
	console.log('   4. Set decision time (e.g., 17:30)');
	console.log('   5. Check logs when decision runs\n');

	console.log('📝 Option 2: Trigger a manual test via ioBroker states');
	console.log('   1. Create a test state in calamari adapter');
	console.log('   2. Write a value to trigger analysis');
	console.log('   3. Check adapter logs for results\n');

	console.log('📝 Option 3: Use the adapter\'s built-in functionality');
	console.log('   When AI Mode is enabled, the adapter will automatically:');
	console.log('   • Query history at configured time');
	console.log('   • Analyze consumption patterns');
	console.log('   • Send data to Claude AI');
	console.log('   • Store decision in states\n');

	console.log('📝 Option 4: Check adapter logs');
	console.log('   $ iobroker logs --watch calamari\n');
}

async function showConfigExample() {
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log('  ⚙️  Example Configuration');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	console.log('For AI Mode to work, configure these in adapter settings:\n');

	console.log('🔧 Required Settings:');
	console.log(`   • History Instance:      ${CONFIG.historyInstance}`);
	console.log(`   • EVCC Power State:      ${CONFIG.evccPowerState}`);
	console.log('   • Claude API Key:        <your-api-key>');
	console.log('   • brightsky Instance:    brightsky.0');
	console.log('   • evcc Instance:         evcc.0\n');

	console.log('⚙️  Optional Settings:');
	console.log('   • AI Decision Time:      17:30');
	console.log('   • Analysis Days:         7');
	console.log('   • Battery Capacity:      10 kWh');
	console.log('   • Min SOC:               20%\n');
}

async function main() {
	try {
		await checkHistoryAdapter();
		await checkStateExists();
		const ConsumptionAnalyzer = await testConsumptionAnalyzer();

		if (ConsumptionAnalyzer) {
			console.log('✅ All components are available!\n');
		} else {
			console.log('⚠️  ConsumptionAnalyzer not available\n');
		}

		await showConfigExample();
		await suggestNextSteps();

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('  ✅ Diagnostic Complete');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	} catch (error) {
		console.error(`\n❌ Error: ${error.message}`);
		console.error(error.stack);
		process.exit(1);
	}
}

main();
