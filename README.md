![Logo](admin/calamari.png)

# ioBroker.calamari

[![NPM version](https://img.shields.io/npm/v/iobroker.calamari.svg)](https://www.npmjs.com/package/iobroker.calamari)
[![Downloads](https://img.shields.io/npm/dm/iobroker.calamari.svg)](https://www.npmjs.com/package/iobroker.calamari)
![Number of Installations](https://iobroker.live/badges/calamari-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/calamari-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.calamari.png?downloads=true)](https://nodei.co/npm/iobroker.calamari/)

**Tests:** ![Test and Release](https://github.com/huepfman/ioBroker.calamari/workflows/Test%20and%20Release/badge.svg)

## calamari adapter for ioBroker

Octopus DE API

### DISCLAIMER

This integration is not officially affiliated with Octopus Energy Germany. Use at your own risk.
This Work based on the Project https://github.com/thecem/octopus_germany

This project is open-source software released under the MIT License.

While we welcome contributions, we are not obligated to provide support, maintenance, or updates for this software.
Users are responsible for ensuring that their use of this software complies with applicable laws and regulations.

### Getting started

This Plugin is used for Integration of Octopus Germany in ioBroker. My Goal was to enable or disable the Smart Loading Function.

npm i iobroker.calamari

After Iintsallation you must add your Account Informations in the Adapter Settings.
At the moment you must also look for your Energy Contract Number and set it in the configuration.

After starting the Adapter there will be a Datapoints with all Informations from the API.

## Changelog

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**

* (huepfman) Integrate brightsky and evcc ioBroker adapters for AI Mode
* (huepfman) Replace external weather APIs with brightsky adapter (DWD weather data)
* (huepfman) Replace MQTT with direct evcc adapter integration
* (huepfman) Enhance PV forecast with actual solar irradiation data from brightsky
* (huepfman) Improve consumption analysis using History adapter
* (huepfman) Add comprehensive test scripts for development and validation

### 0.0.6 (2025-05-18)

chai-as-promised update

### 0.0.5 (2025-05-18)

NPM Package updates
Workflow in GIT

### 0.0.4 (2025-05-18)

- (huepfman) First NPM Release

### 0.0.3 (2025-05-18)

### 0.0.2 (2025-05-18)

- (huepfman) initial release

## 0.0.1 (2025-05-18)

Initial release

## License

MIT License

Copyright (c) 2025 huepfman <trammer@iebl.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
