/**
 * Test script for ConsumptionAnalyzer using ioBroker dev-server
 *
 * This script creates a minimal adapter instance to test the history analysis.
 *
 * Usage:
 *   npm run test:consumption
 */

const { ConsumptionAnalyzer } = require('./lib/aiMode.js');

// Configuration - ADJUST THIS TO YOUR SETUP
const TEST_CONFIG = {
	historyInstance: 'sql.0',
	evccPowerState: 'evcc.0.status.homePower',
	historyAnalysisDays: 7,
	enableHistoryAnalysis: true
};

async function runTest() {
	console.log('═══════════════════════════════════════════════════════════');
	console.log('  🧪 ConsumptionAnalyzer Test');
	console.log('═══════════════════════════════════════════════════════════\n');

	try {
		// Load adapter core
		const utils = require('@iobroker/adapter-core');

		// Create a test adapter instance
		const adapter = utils.adapter({
			name: 'calamari',

			ready: async function() {
				console.log('✅ Adapter started\n');
				console.log('📋 Configuration:');
				console.log(`   History Instance: ${TEST_CONFIG.historyInstance}`);
				console.log(`   Power State: ${TEST_CONFIG.evccPowerState}`);
				console.log(`   Analysis Days: ${TEST_CONFIG.historyAnalysisDays}\n`);

				// Create analyzer
				const analyzer = new ConsumptionAnalyzer(this, TEST_CONFIG);

				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
				console.log('🔍 STEP 1: Fetching Historical Data\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

				const startTime = Date.now();
				const historicalData = await analyzer.getHistoricalData(TEST_CONFIG.historyAnalysisDays);
				const fetchDuration = Date.now() - startTime;

				console.log(`⏱️  Fetch completed in ${fetchDuration}ms\n`);

				if (historicalData.length === 0) {
					console.log('❌ No historical data available!\n');
					console.log('💡 Troubleshooting:');
					console.log(`   1. Check if ${TEST_CONFIG.historyInstance} is running:`);
					console.log(`      iobroker status ${TEST_CONFIG.historyInstance}`);
					console.log(`   2. Check if state exists: ${TEST_CONFIG.evccPowerState}`);
					console.log(`   3. Check if state is being logged in history adapter`);
					console.log(`   4. Check history adapter configuration\n`);
					this.terminate();
					return;
				}

				console.log(`✅ ${historicalData.length} data points fetched\n`);

				// Show data info
				const firstDate = new Date(historicalData[0].ts);
				const lastDate = new Date(historicalData[historicalData.length - 1].ts);
				const daysCovered = ((lastDate - firstDate) / (1000 * 60 * 60 * 24)).toFixed(1);

				console.log('📅 Data Coverage:');
				console.log(`   From: ${firstDate.toISOString()}`);
				console.log(`   To:   ${lastDate.toISOString()}`);
				console.log(`   Span: ${daysCovered} days\n`);

				// Show sample data
				console.log('📊 Sample Data (first 5 points):');
				console.log('   Timestamp                | Value');
				console.log('   -------------------------|-------------');
				historicalData.slice(0, 5).forEach(point => {
					const date = new Date(point.ts);
					const dateStr = date.toISOString().replace('T', ' ').substring(0, 19);
					console.log(`   ${dateStr} | ${String(point.val).padStart(6)}W`);
				});

				console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
				console.log('🔍 STEP 2: Analyzing Consumption Patterns\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

				const analysisStart = Date.now();
				const analysis = await analyzer.analyzeConsumption();
				const analysisDuration = Date.now() - analysisStart;

				console.log(`⏱️  Analysis completed in ${analysisDuration}ms\n`);

				console.log('═══════════════════════════════════════════════════════════');
				console.log('  📊 ANALYSIS RESULTS');
				console.log('═══════════════════════════════════════════════════════════\n');

				// Overall statistics
				console.log('📈 Overall Statistics:');
				console.log(`   Average Power:      ${analysis.overall.averagePower.toFixed(0)}W`);
				console.log(`   Daily Consumption:  ${analysis.overall.dailyConsumption.toFixed(2)} kWh`);
				console.log(`   Data Points:        ${analysis.overall.dataPoints}`);
				console.log(`   Days Analyzed:      ${analysis.overall.daysAnalyzed}\n`);

				// Hourly patterns
				console.log('⏰ Hourly Patterns:\n');
				console.log('   Peak Hours (> 130% of average):');
				if (analysis.hourly.peakHours.length > 0) {
					analysis.hourly.peakHours.forEach((peak, index) => {
						const percentage = ((peak.power / analysis.overall.averagePower - 1) * 100).toFixed(0);
						console.log(`      ${index + 1}. ${String(peak.hour).padStart(2, '0')}:00 - ${peak.power.toFixed(0)}W (+${percentage}%)`);
					});
				} else {
					console.log('      None detected');
				}

				console.log('\n   Low Hours (< 70% of average):');
				if (analysis.hourly.lowHours.length > 0) {
					analysis.hourly.lowHours.forEach((low, index) => {
						const percentage = ((1 - low.power / analysis.overall.averagePower) * 100).toFixed(0);
						console.log(`      ${index + 1}. ${String(low.hour).padStart(2, '0')}:00 - ${low.power.toFixed(0)}W (-${percentage}%)`);
					});
				} else {
					console.log('      None detected');
				}

				// Weekly patterns
				console.log('\n📅 Weekly Patterns:');
				console.log(`   Weekday Average:    ${analysis.weekly.weekdayAverage.toFixed(0)}W`);
				console.log(`   Weekend Average:    ${analysis.weekly.weekendAverage.toFixed(0)}W`);
				const weekDiff = ((analysis.weekly.weekendAverage - analysis.weekly.weekdayAverage) / analysis.weekly.weekdayAverage * 100).toFixed(1);
				console.log(`   Difference:         ${weekDiff > 0 ? '+' : ''}${weekDiff}%\n`);

				// Identified patterns
				console.log('🔍 Identified Patterns:');
				analysis.patterns.forEach((pattern, index) => {
					const emoji = pattern.includes('peak') ? '📈' :
								  pattern.includes('high') ? '🌙' :
								  pattern.includes('low') ? '💤' : '📊';
					console.log(`   ${emoji} ${pattern.replace(/_/g, ' ')}`);
				});

				if (analysis.note) {
					console.log(`\n⚠️  Note: ${analysis.note}`);
				}

				// Hourly breakdown visualization
				console.log('\n📊 Hourly Breakdown (24h Profile):\n');
				console.log('   Hour | Power  | Samples | Bar Chart');
				console.log('   -----|--------|---------|' + '─'.repeat(40));

				const maxPower = Math.max(...analysis.hourly.averageByHour.filter(p => p > 0));
				for (let hour = 0; hour < 24; hour++) {
					const power = analysis.hourly.averageByHour[hour];
					const barLength = Math.round((power / maxPower) * 30);
					const bar = power > 0 ? '█'.repeat(barLength) : '';

					// Color coding
					let marker = ' ';
					if (power > analysis.overall.averagePower * 1.3) marker = '🔴'; // Peak
					else if (power < analysis.overall.averagePower * 0.7) marker = '🟢'; // Low
					else if (power > analysis.overall.averagePower * 1.1) marker = '🟡'; // Above avg

					console.log(`   ${String(hour).padStart(2, '0')}:00 | ${String(power.toFixed(0)).padStart(6)}W | ${marker} | ${bar}`);
				}

				console.log('\n   Legend: 🔴 Peak (>130%)  🟡 High (>110%)  🟢 Low (<70%)\n');

				// AI Prompt format
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
				console.log('🤖 AI PROMPT FORMAT (sent to Claude)\n');
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

				const promptText = analyzer.formatForPrompt(analysis);
				console.log(promptText);

				console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

				// Success summary
				console.log('✅ TEST COMPLETED SUCCESSFULLY!\n');
				console.log('📝 Summary:');
				console.log(`   • ${historicalData.length} data points analyzed`);
				console.log(`   • ${daysCovered} days of consumption data`);
				console.log(`   • ${analysis.patterns.length} patterns identified`);
				console.log(`   • ${analysis.hourly.peakHours.length} peak hours detected`);
				console.log(`   • ${analysis.hourly.lowHours.length} low consumption hours detected\n`);

				console.log('💡 Next Steps:');
				console.log('   1. This analysis will be automatically performed when AI Mode is enabled');
				console.log('   2. The data will be sent to Claude AI for intelligent charging decisions');
				console.log('   3. Patterns help Claude understand when battery discharge is most valuable');
				console.log('   4. Historical data improves decision accuracy over time\n');

				// Terminate adapter
				this.terminate();
			},

			unload: function(callback) {
				callback();
			}
		});

	} catch (error) {
		console.error('\n❌ Test failed with error:');
		console.error(`   ${error.message}\n`);
		console.error('Stack trace:');
		console.error(error.stack);
		process.exit(1);
	}
}

// Run test
runTest();
