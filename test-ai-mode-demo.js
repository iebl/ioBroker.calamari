/**
 * AI Mode Demo - Shows how ConsumptionAnalyzer works
 *
 * This demonstrates the history analysis without needing a running ioBroker instance
 */

const { ConsumptionAnalyzer } = require('./lib/aiMode.js');

// Create mock adapter
class MockAdapter {
	constructor() {
		this.responses = null;
	}

	log = {
		info: (msg) => console.log(`ℹ️  ${msg}`),
		warn: (msg) => console.log(`⚠️  ${msg}`),
		error: (msg) => console.log(`❌ ${msg}`),
		debug: (msg) => console.log(`🔍 ${msg}`)
	};

	// Mock sendTo to simulate history adapter response
	sendTo(target, command, message, callback) {
		console.log(`\n📡 Query to ${target}:`);
		console.log(`   Command: ${command}`);
		console.log(`   State: ${message.id}`);
		console.log(`   Time range: ${new Date(message.options.start).toISOString()} to ${new Date(message.options.end).toISOString()}`);
		console.log(`   Aggregation: ${message.options.aggregate}, Step: ${message.options.step / 60000} min\n`);

		// Simulate response
		setTimeout(() => {
			if (this.responses) {
				console.log(`✅ Returning ${this.responses.length} mock data points\n`);
				callback({ result: this.responses });
			} else {
				console.log(`❌ Simulating: No data available\n`);
				callback({ result: [] });
			}
		}, 100);
	}
}

// Generate realistic mock data for 7 days
function generateMockHistoryData(days = 7) {
	const data = [];
	const now = Date.now();
	const intervalMs = 15 * 60 * 1000; // 15 minutes
	const pointsPerDay = (24 * 60) / 15; // 96 points per day

	for (let day = 0; day < days; day++) {
		for (let point = 0; point < pointsPerDay; point++) {
			const timestamp = now - (days - day) * 24 * 60 * 60 * 1000 + point * intervalMs;
			const date = new Date(timestamp);
			const hour = date.getHours();
			const dayOfWeek = date.getDay();
			const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

			// Realistic consumption pattern
			let basePower = 400; // Base load

			// Morning peak (6-9 AM)
			if (hour >= 6 && hour < 9) {
				basePower += 600;
			}
			// Midday (10-16)
			else if (hour >= 10 && hour < 16) {
				basePower += 200;
			}
			// Evening peak (18-22)
			else if (hour >= 18 && hour < 22) {
				basePower += 800;
			}
			// Night (22-6)
			else if (hour >= 22 || hour < 6) {
				basePower += 100;
			}

			// Weekend variation
			if (isWeekend) {
				basePower *= 1.15;
			}

			// Add some randomness
			const randomVariation = (Math.random() - 0.5) * 200;
			const power = Math.max(200, basePower + randomVariation);

			data.push({
				ts: timestamp,
				val: Math.round(power)
			});
		}
	}

	return data;
}

async function runDemo() {
	console.log('═══════════════════════════════════════════════════════════');
	console.log('  🎭 AI Mode Demo - Consumption Analysis');
	console.log('═══════════════════════════════════════════════════════════\n');

	console.log('This demo shows how the ConsumptionAnalyzer works with');
	console.log('realistic mock data to help you understand what happens');
	console.log('when AI Mode queries your history adapter.\n');

	const config = {
		historyInstance: 'sql.0',
		evccPowerState: 'evcc.0.status.homePower',
		historyAnalysisDays: 7,
		enableHistoryAnalysis: true
	};

	console.log('📋 Configuration:');
	console.log(`   History Instance: ${config.historyInstance}`);
	console.log(`   State: ${config.evccPowerState}`);
	console.log(`   Days: ${config.historyAnalysisDays}\n`);

	// Create mock adapter with realistic data
	const mockAdapter = new MockAdapter();
	mockAdapter.responses = generateMockHistoryData(7);

	console.log(`🎲 Generated ${mockAdapter.responses.length} realistic mock data points`);
	console.log(`   (This simulates 7 days of 15-minute consumption data)\n`);

	// Create analyzer
	const analyzer = new ConsumptionAnalyzer(mockAdapter, config);

	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
	console.log('🔍 STEP 1: Fetching Historical Data\n');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	const historicalData = await analyzer.getHistoricalData(7);

	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
	console.log('🔍 STEP 2: Analyzing Consumption Patterns\n');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	const analysis = await analyzer.analyzeConsumption();

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
	console.log('⏰ Peak Hours:');
	analysis.hourly.peakHours.forEach((peak, i) => {
		const percentage = ((peak.power / analysis.overall.averagePower - 1) * 100).toFixed(0);
		console.log(`   ${i + 1}. ${String(peak.hour).padStart(2, '0')}:00 - ${peak.power.toFixed(0)}W (+${percentage}%)`);
	});

	console.log('\n   Low Hours:');
	analysis.hourly.lowHours.forEach((low, i) => {
		const percentage = ((1 - low.power / analysis.overall.averagePower) * 100).toFixed(0);
		console.log(`   ${i + 1}. ${String(low.hour).padStart(2, '0')}:00 - ${low.power.toFixed(0)}W (-${percentage}%)`);
	});

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

	// Hourly breakdown
	console.log('\n📊 24-Hour Profile:\n');
	console.log('   Hour | Power  | Bar');
	console.log('   -----|--------|' + '─'.repeat(40));

	const maxPower = Math.max(...analysis.hourly.averageByHour);
	for (let hour = 0; hour < 24; hour++) {
		const power = analysis.hourly.averageByHour[hour];
		const barLength = Math.round((power / maxPower) * 30);
		const bar = '█'.repeat(barLength);

		let marker = ' ';
		if (power > analysis.overall.averagePower * 1.3) marker = '🔴';
		else if (power < analysis.overall.averagePower * 0.7) marker = '🟢';
		else if (power > analysis.overall.averagePower * 1.1) marker = '🟡';

		console.log(`   ${String(hour).padStart(2, '0')}:00 | ${String(power.toFixed(0)).padStart(6)}W ${marker} | ${bar}`);
	}

	console.log('\n   Legend: 🔴 Peak (>130%)  🟡 High (>110%)  🟢 Low (<70%)\n');

	// AI Prompt
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
	console.log('🤖 Data sent to Claude AI:\n');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	const promptText = analyzer.formatForPrompt(analysis);
	console.log(promptText);

	console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	console.log('✅ DEMO COMPLETED!\n');
	console.log('💡 What happens in production:');
	console.log('   1. ConsumptionAnalyzer queries your real history adapter');
	console.log('   2. It analyzes 7 days of actual consumption data');
	console.log('   3. Patterns are identified (morning peak, evening peak, etc.)');
	console.log('   4. This data is sent to Claude AI along with:');
	console.log('      - Weather forecast from brightsky');
	console.log('      - PV production forecast');
	console.log('      - Current battery SOC from evcc');
	console.log('      - Cheap electricity phases from Octopus');
	console.log('   5. Claude makes an intelligent charging decision\n');

	console.log('🔧 To test with your real data:');
	console.log('   1. Make sure history adapter is running and logging evcc.0.status.homePower');
	console.log('   2. Install the adapter in ioBroker');
	console.log('   3. Enable AI Mode in adapter settings');
	console.log('   4. Check logs at the configured decision time (default 17:30)\n');
}

runDemo().catch(error => {
	console.error('❌ Demo failed:', error);
	process.exit(1);
});
