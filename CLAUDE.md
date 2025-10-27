# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an ioBroker adapter for integrating Octopus Energy Germany API. The adapter enables control of smart charging features for electric vehicles through the Octopus Germany platform. Based on the Python project https://github.com/thecem/octopus_germany, this is a Node.js implementation designed specifically for ioBroker.

## Architecture

### Core Components

- **main.js**: The main adapter class (`Calamari`) that extends `@iobroker/adapter-core`. Handles:
  - Adapter lifecycle (ready, stateChange, unload)
  - Periodic polling of API data
  - Automatic creation of ioBroker data points from API responses
  - State subscriptions for device control (e.g., suspend/unsuspend charging)

- **lib/octopusGermany.js**: The API client implementation with two main classes:
  - `TokenManager`: Manages JWT authentication tokens with automatic refresh logic, expiry tracking, and retry mechanisms
  - `OctopusGermany`: Main API client providing methods for:
    - Authentication via GraphQL mutations
    - Fetching account data, devices, and dispatch schedules
    - Device control (suspension/resumption of smart charging)
    - Vehicle charging preference configuration

### API Integration

The adapter uses GraphQL to communicate with `https://api.oeg-kraken.energy/v1/graphql/`. Key queries:
- `COMPREHENSIVE_QUERY`: Fetches account details, devices, completed/planned dispatches, electricity agreements, and pricing
- `ACCOUNT_DISCOVERY_QUERY`: Lists all accounts for the authenticated user
- Mutations for device control and vehicle preferences

### Data Flow

1. User configures email, password, account number, and poll interval in admin UI
2. On `onReady()`, adapter initializes `OctopusGermany` and performs login
3. Token manager handles JWT lifecycle with automatic refresh every hour
4. Adapter polls `fetchAllData()` at configured interval (default 60 seconds)
5. Data is recursively converted to ioBroker data points via `createDataPointsFromJson()`
6. State changes to `devices.0.status.isSuspended` trigger API calls to suspend/unsuspend smart charging

### Configuration

Configuration is defined in:
- **io-package.json**: Adapter metadata, instance objects, native settings defaults
- **admin/jsonConfig.json**: JSON-based configuration UI with fields:
  - `server`: API endpoint (default: https://api.oeg-kraken.energy/v1/graphql/)
  - `email`: User's Octopus account email
  - `password`: Account password (encrypted)
  - `account`: Electricity contract number
  - `pollInterval`: Update frequency in seconds (5-3600, default 60)

## Development Commands

### Testing
```bash
npm test                    # Run all tests (JS tests + package tests)
npm run test:js            # Run unit/module tests only
npm run test:package       # Run package structure tests
npm run test:integration   # Run integration tests
```

For single test file:
```bash
mocha --config test/mocharc.custom.json path/to/test.js
```

### Code Quality
```bash
npm run check              # TypeScript type checking (no emit)
npm run lint               # ESLint validation
```

### Release
```bash
npm run release            # Patch version release
npm run release-minor      # Minor version release
npm run release-major      # Major version release
```

Uses `@alcalzone/release-script` with plugins: iobroker, license, manual-review.

## Key Implementation Details

### Token Management
- Global singleton `_GLOBAL_TOKEN_MANAGER` prevents multiple instances from redundant logins
- Tokens are decoded to extract expiry timestamp
- Refresh occurs automatically 5 minutes before expiry
- Retry logic with exponential backoff handles rate limiting (error code `KT-CT-1199`)
- Token expiry (error code `KT-CT-1124`) triggers automatic re-authentication and retry

### State Management
- Adapter dynamically creates data points from JSON responses
- Nested objects become channels, primitives become states
- Arrays are stored as JSON strings with optional individual element states
- The adapter subscribes to `devices.0.status.isSuspended` to enable user control of charging suspension

### Error Handling
- Non-critical errors for missing devices/dispatches (error `KT-CT-4301`) are logged as warnings
- Partial data is returned when possible (e.g., account data even if devices fail)
- Critical errors prevent the entire request from returning data

### Polling Strategy
The adapter uses `setInterval` in main.js:48-56 with user-configurable interval. No cleanup is implemented in `onUnload()`, which may cause issues if the adapter is stopped - consider clearing `this.pollInterval` in the unload handler.

## Testing Framework

Tests use Mocha, Chai, Chai-as-Promised, Sinon, and Proxyquire. The test structure:
- **main.test.js**: Unit tests for the adapter (currently contains dummy test)
- **test/package.js**: Validates package.json and io-package.json structure
- **test/integration.js**: Integration tests (exit quickly if not configured)

## Language and Translations

The adapter supports multiple languages with i18n files in `admin/i18n/*/translations.json`. Supported languages: en, de, es, fr, it, nl, pl, pt, ru, uk, zh-cn.

## Recent Improvements (Latest Update)

### Security & Stability
- **Fixed**: Removed all password logging from code (critical security issue)
- **Fixed**: Replaced all console.log with proper adapter.log calls
- **Fixed**: Corrected async/await usage in onReady() - login is now properly awaited
- **Fixed**: Implemented proper cleanup in onUnload() - stops polling and token refresh
- **Added**: Comprehensive error handling in fetchDataFromAPI()
- **Added**: Null-checks and ack-checks in onStateChange() to prevent crashes

### Performance & Optimization
- **Implemented**: Instanz-spezifischer TokenManager (replaces global singleton)
- **Implemented**: Automatic rate-limiting with exponential backoff for all API calls
- **Implemented**: Caching strategy for static data (account: 1h, devices: 5min, dispatches: 1min)
- **Implemented**: State updates only occur when values change (reduces ioBroker load)
- **Added**: Separate API methods: `fetchDevices()`, `fetchDispatches()` for optimized queries

### New Features
- **Multi-Device Support**: Automatically detects and subscribes to all devices (not just device 0)
- **Alert System**: Processes device alerts and creates alert states with notifications
- **Pricing Data**: Extracts and creates readable states for electricity rates and time-of-use tariffs
- **Account Auto-Discovery**: Automatically discovers account number if not configured
- **Charging Preferences UI**: Configure vehicle charging targets via Admin UI
- **Cheap Phase Detection**: Real-time detection of cheap electricity phases from plannedDispatches
  - Boolean state indicating if currently in a cheap phase
  - Current phase details (start, end, remaining minutes, energy)
  - Next phase information (start, end, minutes until start, energy)
  - Updates every 60 seconds automatically

### Admin UI Enhancements
- Added structured sections (Connection, Polling, Charging Preferences, AI Mode)
- Account field now optional (auto-discovery supported)
- New charging preference settings:
  - Enable/disable charging preferences
  - Weekday/weekend target SoC (%)
  - Weekday/weekend target times (HH:MM)
- Comprehensive AI Mode configuration section with conditional visibility

## AI Mode Architecture (Beta Feature)

The AI Mode feature enables intelligent battery charging decisions based on weather forecasts, PV production predictions, and electricity price data. This feature is optional and can be enabled via the admin UI.

### Components (lib/aiMode.js)

**1. WeatherService**
- Fetches weather forecasts from multiple providers (OpenWeatherMap, WeatherAPI.com, Tomorrow.io)
- Returns hourly forecast data including:
  - Temperature (affects PV efficiency)
  - Cloud coverage (0-100%, affects solar irradiance)
  - Precipitation
  - Wind speed
- Supports configurable forecast duration (default: 2 days)

**2. PVForecast**
- Calculates expected PV production based on weather forecast
- Multi-array support (up to 3 PV arrays with different orientations)
- Factors considered:
  - Solar irradiance estimation (time of day, seasonal variations)
  - Array orientation (E/W perform better at sunrise/sunset, S at noon)
  - Tilt angle optimization (compared to latitude)
  - Temperature derating (efficiency drops ~0.4% per °C above 25°C)
  - Cloud coverage impact (up to 75% reduction at 100% cloud)
- Returns hourly production estimates in kWh

**3. EVCCAdapter**
- Reads real-time data from evcc ioBroker adapter states
- Reads from states:
  - `evcc.X.status.pv`: Current PV production
  - `evcc.X.status.batteryPower`: Battery charge/discharge power
  - `evcc.X.status.batterySoc`: Current battery state of charge
  - `evcc.X.status.grid`: Grid import/export
  - `evcc.X.status.homePower`: House consumption
- Provides `getData()` method for current values
- No external MQTT broker required - uses ioBroker states directly

**4. ConsumptionAnalyzer**
- Analyzes historical consumption data from History Adapter
- Queries last 7 days of 15-minute averaged data
- Calculates patterns:
  - Hourly average consumption (24 data points)
  - Weekday vs weekend patterns
  - Peak consumption hours
  - Low consumption hours
  - Daily consumption totals
- Identifies patterns:
  - Morning peak (6-9 AM)
  - Evening peak (18-22)
  - High/low night consumption
  - Higher weekday/weekend usage
- Provides fallback default values if no historical data available
- Formats analysis for Claude AI prompt

**5. ClaudeAI**
- Integrates with Anthropic Claude API for intelligent decision-making
- Receives comprehensive context:
  - Current battery SOC and configuration
  - Real-time consumption and PV data
  - **Historical consumption patterns (7 days)**
  - Cheap electricity phases from Octopus
  - Weather forecast
  - PV production prediction
- Returns structured decision:
  - `shouldCharge`: Boolean recommendation
  - `reason`: Explanation of the decision
  - `confidence`: 0-100% confidence level
  - `targetSoc`: Recommended target state of charge
  - `estimatedChargingTime`: Estimated time needed
- Uses configurable Claude model (Sonnet, Haiku, or Opus)

**6. AIDecisionEngine**
- Orchestrates all components
- Scheduling:
  - Makes daily decision at configured time (default: 17:30)
  - Ensures execution after Octopus dispatches are available (after 17:00)
  - Auto-schedules next decision for following day
- Error handling:
  - Graceful degradation if components fail
  - Continues adapter operation even if AI mode fails
  - Falls back to defaults if history data unavailable
- State management:
  - Creates and updates aiMode.* states
  - Stores decision history and reasoning

### AI Mode States

When AI Mode is enabled, the following states are created:

- `calamari.0.aiMode.recommendation.shouldCharge`: Boolean - AI recommendation to charge
- `calamari.0.aiMode.recommendation.reason`: String - Explanation of decision
- `calamari.0.aiMode.recommendation.confidence`: Number (%) - AI confidence level
- `calamari.0.aiMode.recommendation.targetSoc`: Number (%) - Recommended target SoC
- `calamari.0.aiMode.lastDecision`: String (ISO timestamp) - When last decision was made

### AI Mode Workflow

1. **Daily Trigger**: At configured time (e.g., 17:30)
2. **Data Gathering**:
   - Fetch weather forecast for next N days
   - Calculate PV production forecast
   - Get current battery SoC and consumption from evcc adapter states
   - **Query historical consumption from History Adapter (last 7 days)**
   - **Analyze consumption patterns (hourly, daily, weekly)**
   - Retrieve cheap phases from plannedDispatches
3. **AI Analysis**: Send all data to Claude API including historical patterns
4. **Decision**: Claude analyzes and returns recommendation considering:
   - Expected PV production vs typical consumption
   - Peak hours when battery discharge is most valuable
   - Weekday vs weekend patterns
   - Available cheap electricity phases
5. **State Update**: Store decision and reasoning in states
6. **User Action**: User can view recommendation and manually act on it

### Integration with History Adapter

The AI mode requires a History Adapter to analyze consumption patterns:

- **Supported adapters**: history, sql, influxdb
- **Data requirements**:
  - Must log evcc home power consumption (default: `evcc.0.site.homePower`)
  - Recommended logging interval: 15 minutes or less
  - Minimum 7 days of historical data for good patterns
- **What it analyzes**:
  - Average consumption per hour (24 data points)
  - Weekday vs weekend consumption differences
  - Peak consumption times (morning, evening)
  - Low consumption periods (night, midday)
  - Overall daily consumption average
- **Benefits**:
  - More accurate battery capacity planning
  - Better understanding of when battery discharge is most valuable
  - Seasonal pattern recognition (if enough data)
  - Improved confidence in AI recommendations
- **Graceful degradation**: If history data is unavailable, uses reasonable defaults

### Integration with evcc

The AI mode integrates with evcc (https://evcc.io/) for real-time energy monitoring:

- evcc ioBroker adapter must be installed and running
- Calamari adapter reads data directly from evcc adapter states
- Data is used for:
  - Understanding current consumption patterns
  - Monitoring battery state
  - Verifying PV production vs forecast
- The recommendation is informational only - user must configure evcc charging rules

### Weather API Providers

**OpenWeatherMap** (default)
- Free tier: 1000 calls/day
- 5-day forecast in 3-hour intervals
- URL: https://openweathermap.org/api

**WeatherAPI.com**
- Free tier: 1M calls/month
- Hourly forecast up to 3 days
- URL: https://www.weatherapi.com/

**Tomorrow.io**
- Free tier: 500 calls/day, 25 calls/hour
- Hourly forecast up to 5 days
- URL: https://www.tomorrow.io/

### Cost Estimation

**Claude API Costs** (approximate, as of Jan 2025):
- Claude 3.5 Sonnet: ~$3 per 1M input tokens, ~$15 per 1M output tokens
- Claude 3.5 Haiku: ~$0.25 per 1M input tokens, ~$1.25 per 1M output tokens
- Claude 3 Opus: ~$15 per 1M input tokens, ~$75 per 1M output tokens

Daily decision (~1000 input tokens, ~200 output tokens):
- Sonnet: ~$0.006/day = ~$2.20/year
- Haiku: ~$0.0005/day = ~$0.18/year
- Opus: ~$0.03/day = ~$11/year

**Weather API Costs**:
- OpenWeatherMap Free: $0 (sufficient for 1 decision/day)
- WeatherAPI.com Free: $0 (sufficient)
- Tomorrow.io Free: $0 (sufficient)

## Configuration

### Required Settings
- `email`: Octopus account email
- `password`: Account password (encrypted)
- `account`: Contract number (optional - will auto-discover if empty)
- `pollInterval`: Update frequency in seconds (5-3600, default 60)

### Optional Settings - Charging Preferences
- `enableChargingPreferences`: Enable automatic charging preference configuration
- `weekdayTargetSoc`: Weekday charge target (0-100%, default 80)
- `weekendTargetSoc`: Weekend charge target (0-100%, default 90)
- `weekdayTargetTime`: Weekday target time (HH:MM, default "07:00")
- `weekendTargetTime`: Weekend target time (HH:MM, default "09:00")

### Optional Settings - AI Mode (Beta)
- `enableAiMode`: Enable AI-based battery charging decisions (default: false)

**Weather API Settings:**
- `weatherApiProvider`: Weather service provider ("openweathermap", "weatherapi", "tomorrow")
- `weatherApiKey`: API key for weather service (encrypted)
- `locationLat`: Latitude of installation location
- `locationLon`: Longitude of installation location

**Claude AI Settings:**
- `claudeApiKey`: Anthropic Claude API key for AI decisions (encrypted)
- `claudeModel`: Claude model to use (default: "claude-3-5-sonnet-20241022")
  - claude-3-5-sonnet-20241022 (recommended, balanced)
  - claude-3-5-haiku-20241022 (fast & cheap)
  - claude-3-opus-20240229 (most capable)

**PV System Configuration:**
- `pvArray1Enabled`: Enable PV array 1 (default: true)
- `pvArray1Power`: Array 1 peak power in kWp (default: 3)
- `pvArray1Orientation`: Array 1 orientation (N/NE/E/SE/S/SW/W/NW, default: "E")
- `pvArray1Tilt`: Array 1 tilt angle 0-90° (default: 0)
- `pvArray2Enabled`, `pvArray2Power`, `pvArray2Orientation`, `pvArray2Tilt`: Same for array 2 (default: 4.2 kWp, S, 52°)
- `pvArray3Enabled`, `pvArray3Power`, `pvArray3Orientation`, `pvArray3Tilt`: Same for array 3 (default: 1.6 kWp, W, 0°)

**Battery Configuration:**
- `batteryCapacity`: Battery capacity in kWh (default: 10)
- `batteryMinSoc`: Minimum state of charge in % (default: 20)
- `batteryMaxChargePower`: Maximum charging power in kW (default: 5)

**EVCC Adapter Integration:**
- `evccInstance`: evcc adapter instance name (default: "evcc.0")

**Historical Consumption Analysis:**
- `enableHistoryAnalysis`: Enable analysis of historical consumption data (default: true)
- `historyInstance`: History adapter instance name (default: "history.0")
  - Also supports: "sql.0", "influxdb.0", etc.
- `evccPowerState`: State path for home power consumption (default: "evcc.0.site.homePower")
- `historyAnalysisDays`: Number of days to analyze (1-30, default: 7)

**AI Decision Settings:**
- `aiDecisionTime`: Daily time when AI makes decision (default: "17:30")
- `aiConsiderDays`: Number of forecast days to consider (1-7, default: 2)

## API Methods

### Core Methods
- `fetchAllData(accountNumber)`: Comprehensive data fetch (account, devices, dispatches)
- `fetchDevices(accountNumber, useCache=true)`: Fetch only devices with caching
- `fetchDispatches(accountNumber, useCache=true)`: Fetch only dispatches with caching
- `changeDeviceSuspension(deviceId, action)`: Suspend/unsuspend smart charging
- `setVehicleChargePreferences(...)`: Configure vehicle charging settings
- `invalidateCache(cacheKey)`: Manually clear cache

### Helper Methods
- `accounts()`: List all account numbers for the user
- `formatTimeToHhMm(timeStr)`: Format time strings to HH:MM

## Data Structure

### Generated States
- `calamari.0.account.*`: Account information and ledgers
- `calamari.0.devices.N.*`: Device information (N = device index)
  - `devices.N.status.isSuspended`: Control charging suspension (writable)
  - `devices.N.alerts.N`: Device alerts
- `calamari.0.plannedDispatches.*`: Upcoming charging schedules
- `calamari.0.completedDispatches.*`: Past charging sessions
- `calamari.0.pricing.*`: Electricity rates and tariff information
  - `pricing.malo_X_agreement_Y.grossRate`: Gross rate in ct/kWh
  - `pricing.malo_X_agreement_Y.netRate`: Net rate in ct/kWh
  - `pricing.malo_X_agreement_Y.timeslot_Z.*`: Time-of-use rates
- `calamari.0.cheapPhase.*`: Cheap electricity phase detection
  - `cheapPhase.active`: Boolean - true when in a cheap phase (MAIN STATE)
  - `cheapPhase.current.start`: ISO timestamp of current phase start
  - `cheapPhase.current.end`: ISO timestamp of current phase end
  - `cheapPhase.current.deltaKwh`: Planned energy consumption in kWh
  - `cheapPhase.current.remainingMinutes`: Minutes remaining in current phase
  - `cheapPhase.next.start`: ISO timestamp of next phase start
  - `cheapPhase.next.end`: ISO timestamp of next phase end
  - `cheapPhase.next.deltaKwh`: Planned energy for next phase in kWh
  - `cheapPhase.next.minutesUntilStart`: Minutes until next phase begins
- `calamari.0.aiMode.*`: AI Mode states (only created when AI Mode is enabled)
  - `aiMode.recommendation.shouldCharge`: Boolean - AI recommendation to charge
  - `aiMode.recommendation.reason`: String - Explanation of decision
  - `aiMode.recommendation.confidence`: Number (%) - AI confidence level
  - `aiMode.recommendation.targetSoc`: Number (%) - Recommended target SoC
  - `aiMode.lastDecision`: String (ISO timestamp) - When last decision was made

## Important Notes

- Requires Node.js >= 20
- Requires js-controller >= 6.0.11 and admin >= 7.4.10
- Password and API keys are encrypted in configuration (`encryptedNative` in io-package.json)
- All sensitive logging has been removed
- Rate limiting is automatically handled with retry logic
- Cache is automatically invalidated after device suspension changes

**AI Mode Requirements:**
- AI Mode requires Claude AI API key - obtain from Anthropic separately
- AI Mode dependencies: `@anthropic-ai/sdk`, `axios` (automatically installed)
- AI Mode is completely optional and disabled by default
- **Requires evcc ioBroker adapter to be installed and running**
- **Requires brightsky ioBroker adapter for weather forecasts**
- **Historical analysis requires a History Adapter (history, sql, or influxdb)**
- **Must log evcc home power consumption with 15-minute intervals**
- **Minimum 7 days of historical data recommended for accurate patterns**
- Falls back to defaults if history data unavailable
