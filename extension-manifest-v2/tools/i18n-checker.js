/**
 * i18n Checker
 *
 * Ghostery Browser Extension
 * http://www.ghostery.com/
 *
 * Copyright 2019 Ghostery, Inc. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

/* eslint import/no-extraneous-dependencies: 0 */
/* eslint no-console: 0 */

console.time('i18n-checker');

const { local } = require('d3');
const fs = require('fs-extra');
const jsonfile = require('jsonfile');
const oboe = require('oboe');

// Constants
const LOCALES_FOLDER = './_locales';
const GATHER_FILE_PATHS_EXCEPTIONS = ['.DS_Store'];
const COMMUNITY_LOCALES = ['vi'];
const LANG_FILES_COUNT = 14;
const DEFAULT_LOCALE_PATH = './_locales/en/messages.json';
const DUPLICATE_TOKENS_FILE = './tools/i18n_results/duplicate_tokens.txt';
const MISSING_TOKENS_FILE = './tools/i18n_results/missing_tokens.txt';
const EXTRA_TOKENS_FILE = './tools/i18n_results/extra_tokens.txt';
const MALFORMED_TOKENS_FILE = './tools/i18n_results/malformed_tokens.txt';
const MISSING_PLACEHOLDERS_FILE = './tools/i18n_results/missing_placeholders.txt';
const EXTRA_PLACEHOLDERS_FILE = './tools/i18n_results/extra_placeholders.txt';
const MALFORMED_PLACEHOLDERS_FILE = './tools/i18n_results/malformed_placeholders.txt';

// Empty tools/i18n_results directory
fs.emptyDirSync('./tools/i18n_results');

/**
 * Gathers the paths of the locale files
 * @const  string  LOCALES_FOLDER                The folder we search for locales
 * @const  array   GATHER_FILE_PATHS_EXCEPTIONS  Files in the LOCALE_FOLDER that we should skip
 * @const  int     LANG_FILES_COUNT              The number of locales we should find in LOCALES_FOLDER
 * @return Promise                               Resolves with the paths to all locale files if no errors,
 *                                               Rejects otherwise
 */
function gatherFilePaths() {
	return new Promise((resolve, reject) => {
		const paths = [];
		fs.readdir(LOCALES_FOLDER, (err, files) => {
			let langFilesCounted = 0;
			files.forEach((locale) => {
				// Validate that the locale is named correctly, eg: en_GB
				if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(locale)) {
					if (GATHER_FILE_PATHS_EXCEPTIONS.indexOf(locale) === -1) {
						console.log('Error: "%s" is not a valid locale', locale);
					}
					return;
				}
				if (COMMUNITY_LOCALES.indexOf(locale) >= 0) {
					return;
				}
				langFilesCounted += 1;
				paths.push(`${LOCALES_FOLDER}/${locale}/messages.json`);
			});
			if (langFilesCounted === LANG_FILES_COUNT) {
				console.log('Correctly found %d of %d locale files.',
					LANG_FILES_COUNT, langFilesCounted);
				resolve(paths);
			} else {
				console.log('Error: there should be %d locale files, only scanned %d.',
					LANG_FILES_COUNT, langFilesCounted);
				reject();
			}
		});
	});
}

/**
 * Validates whether all the locale files are valid JSON
 * @param  array   paths  An array of strings denoting the paths to all the locale files
 * @return Promise        Resolves with the paths passed as a param if all files are valid JSON
 *                        Rejects otherwise
 */
function validateJson(paths) {
	return new Promise((resolve, reject) => {
		let hasError = false;
		paths.forEach((path) => {
			try {
				const file = jsonfile.readFileSync(`${path}`);
				Object.keys(file).forEach((key) => {
					if (!/^\w*$/.test(key)) {
						hasError = true;
						console.log('Error: file %s has invalid key "%s".', path, key);
					}
				});
			} catch (err) {
				hasError = true;
				console.log('Error: file "%s" is not valid JSON.', path);
			}
		});
		if (hasError) {
			reject();
		} else {
			console.log('All locale files are valid JSON.');
			resolve(paths);
		}
	});
}

/**
 * Outputs the contents of an object to a .txt file.
 * @param  string fileName       The location of the file we will output to
 * @param  object resultsObject  An object with the data we will output
 * @return none
 */
function recordResults(fileName, resultsObject) {
	const stream = fs.createWriteStream(fileName);
	stream.once('open', () => {
		Object.keys(resultsObject).forEach((key) => {
			stream.write(`${key}[${resultsObject[key].length}]:\n`);
			resultsObject[key].forEach((duplicate) => {
				stream.write(`${duplicate}\n`);
			});
			stream.write('\n');
		});
		stream.end();
	});
}

/**
 * Checks for duplicates in all the locale files. Writes found duplicates to a file
 * @param array   paths                  An array of strings denoting the paths to all the locale files
 * @const  string  DUPLICATE_TOKENS_FILE  The file where we should write the found duplicates
 * @const  int     LANG_FILES_COUNT       The number of we are searching over
 * @return Promise                        Resolves if no duplicates were found,
 *                                        Rejects otherwise
 */
function findDuplicates(paths) {
	return new Promise((resolve, reject) => {
		let langFilesCounted = 0;
		let hasDuplicates = false;
		const duplicates = {};
		paths.forEach((path) => {
			const foundKeys = {};
			const locale = path.match(/_locales\/(.*)\/messages.json/)[1];
			duplicates[locale] = [];
			oboe(fs.createReadStream(path)).node('{message}', (val, keys) => {
				const key = keys[0];
				if (foundKeys.hasOwnProperty(key)) {
					hasDuplicates = true;
					duplicates[locale].push(key);
					return;
				}
				foundKeys[key] = true;
			}).done(() => {
				langFilesCounted += 1;
				if (langFilesCounted === LANG_FILES_COUNT) {
					if (hasDuplicates) {
						console.log('Error: duplicate tokens were found. See them in `%s`.', DUPLICATE_TOKENS_FILE);
						recordResults(DUPLICATE_TOKENS_FILE, duplicates);
						reject();
					} else {
						console.log('Scanned all locale files for duplicate tokens, none found.');
						resolve();
					}
				}
			});
		});
	});
}

/**
 * Checks for missing tokens in all the locale files. Writes the list of missing tokens to a file
 * @param array   paths                An array of strings denoting the paths to all the locale files
 * @const  string  DEFAULT_LOCALE_PATH  The location of the default locale JSON file
 * @const  string  MISSING_TOKENS_FILE  The file where we should write the missing tokens
 * @return Promise                      Resolves if no missing tokens were found,
 *                                      Rejects otherwise
 */
function findMissingKeys(paths) {
	return new Promise((resolve, reject) => {
		const defaultLocaleJson = jsonfile.readFileSync(DEFAULT_LOCALE_PATH);
		let hasMissingKeys = false;
		const missingKeys = {};
		paths.forEach((path) => {
			const localeJson = jsonfile.readFileSync(`${path}`);
			const locale = path.match(/_locales\/(.*)\/messages.json/)[1];
			missingKeys[locale] = [];
			Object.keys(defaultLocaleJson).forEach((key) => {
				if (!localeJson.hasOwnProperty(key)) {
					hasMissingKeys = true;
					missingKeys[locale].push(key);
				}
			});
		});
		if (hasMissingKeys) {
			console.log('Error: missing tokens were found. See them in `%s', MISSING_TOKENS_FILE);
			recordResults(MISSING_TOKENS_FILE, missingKeys);
			reject();
		} else {
			console.log('Scanned all locale files for missing tokens, none found.');
			resolve();
		}
	});
}

/**
 * Checks for extra tokens in all the locale files. Writes the list of extra tokens to a file
 * @param array   paths                An array of strings denoting the paths to all the locale files
 * @const  string  DEFAULT_LOCALE_PATH  The location of the default locale JSON file
 * @const  string  EXTRA_TOKENS_FILE    The file where we should write the extra tokens
 * @return Promise                      Resolves if no extra tokens were found,
 *                                      Rejects otherwise
 */
function findExtraKeys(paths) {
	return new Promise((resolve, reject) => {
		const defaultLocaleJson = jsonfile.readFileSync(DEFAULT_LOCALE_PATH);
		let hasExtraKeys = false;
		const extraKeys = {};
		paths.forEach((path) => {
			const localeJson = jsonfile.readFileSync(`${path}`);
			const locale = path.match(/_locales\/(.*)\/messages.json/)[1];
			extraKeys[locale] = [];
			Object.keys(localeJson).forEach((key) => {
				if (!defaultLocaleJson.hasOwnProperty(key)) {
					hasExtraKeys = true;
					extraKeys[locale].push(key);
				}
			});
		});
		if (hasExtraKeys) {
			console.log('Error: extra tokens were found. See them in `%s', EXTRA_TOKENS_FILE);
			recordResults(EXTRA_TOKENS_FILE, extraKeys);
			reject();
		} else {
			console.log('Scanned all locale files for extra tokens, none found.');
			resolve();
		}
	});
}

/**
 * Checks for malformed token key objects in all the locale files. Writes the list of malformed tokens to a file
 * @param array   paths                  An array of strings denoting the paths to all the locale files
 * @const  string  MALFORMED_TOKENS_FILE  The file where we should write the malformed tokens
 * @return Promise                        Resolves if no malformed tokens were found,
 *                                        Rejects otherwise
 */
function findMalformedKeys(paths) {
	return new Promise((resolve, reject) => {
		let hasMalformedKeys = false;
		const malformedKeys = {};
		paths.forEach((path) => {
			const localeJson = jsonfile.readFileSync(`${path}`);
			const locale = path.match(/_locales\/(.*)\/messages.json/)[1];
			malformedKeys[locale] = [];
			Object.keys(localeJson).forEach((key) => {
				if (!localeJson[key].hasOwnProperty('message')) {
					hasMalformedKeys = true;
					malformedKeys[locale].push(key);
				}
			});
		});
		if (hasMalformedKeys) {
			console.log('Error: malformed tokens were found. See them in `%s', MALFORMED_TOKENS_FILE);
			recordResults(MALFORMED_TOKENS_FILE, malformedKeys);
			reject();
		} else {
			console.log('Scanned all locale files for malformed tokens, none found.');
			resolve();
		}
	});
}

/**
 * Checks for missing placeholders in all the locale files. Writes the list of missing placeholders to a file
 * @param array   paths                      An array of strings denoting the paths to all the locale files
 * @const  string  DEFAULT_LOCALE_PATH        The location of the default locale JSON file
 * @const  string  MISSING_PLACEHOLDERS_FILE  The file where we should write the extra tokens
 * @return Promise                            Resolves if no extra tokens were found,
 *                                            Rejects otherwise
 */
function findMissingPlaceholders(paths) {
	return new Promise((resolve, reject) => {
		const defaultLocaleJson = jsonfile.readFileSync(DEFAULT_LOCALE_PATH);
		let hasMissingPlaceholders = false;
		const missingPlaceholders = {};
		paths.forEach((path) => {
			const localeJson = jsonfile.readFileSync(`${path}`);
			const locale = path.match(/_locales\/(.*)\/messages.json/)[1];
			missingPlaceholders[locale] = [];
			Object.keys(defaultLocaleJson).forEach((key) => {
				if (defaultLocaleJson[key].hasOwnProperty('placeholders')) {
					if (!localeJson[key] || !localeJson[key].hasOwnProperty('placeholders')) {
						hasMissingPlaceholders = true;
						missingPlaceholders[locale].push(`${key}: missing ${Object.keys(defaultLocaleJson[key].placeholders).length} placeholder(s)`);
						return;
					}
					Object.keys(defaultLocaleJson[key].placeholders).forEach((placeholder) => {
						if (!localeJson[key].placeholders[placeholder]) {
							hasMissingPlaceholders = true;
							missingPlaceholders[locale].push(`${key}: ${placeholder}`);
						}
					});
				}
			});
		});
		if (hasMissingPlaceholders) {
			console.log('Error: missing placeholders were found. See them in `%s`', MISSING_PLACEHOLDERS_FILE);
			recordResults(MISSING_PLACEHOLDERS_FILE, missingPlaceholders);
			reject();
		} else {
			console.log('Scanned all locale files for missing placeholders, none found.');
			resolve();
		}
	});
}

/**
 * Checks for extra placeholders in all the locale files. Writes the list of extra placeholders to a file
 * @param array   paths                    An array of strings denoting the paths to all the locale files
 * @const  string  DEFAULT_LOCALE_PATH      The location of the default locale JSON file
 * @const  string  EXTRA_PLACEHOLDERS_FILE  The file where we should write the extra tokens
 * @return Promise                          Resolves if no extra tokens were found,
 *                                          Rejects otherwise
 */
function findExtraPlaceholders(paths) {
	return new Promise((resolve, reject) => {
		const defaultLocaleJson = jsonfile.readFileSync(DEFAULT_LOCALE_PATH);
		let hasExtraPlaceholders = false;
		const extraPlaceholders = {};
		paths.forEach((path) => {
			const localeJson = jsonfile.readFileSync(`${path}`);
			const locale = path.match(/_locales\/(.*)\/messages.json/)[1];
			extraPlaceholders[locale] = [];
			Object.keys(localeJson).forEach((key) => {
				if (localeJson[key].hasOwnProperty('placeholders')) {
					if (!defaultLocaleJson[key] || !defaultLocaleJson[key].hasOwnProperty('placeholders')) {
						hasExtraPlaceholders = true;
						extraPlaceholders[locale].push(`${key}: has ${Object.keys(localeJson[key].placeholders).length} extra placeholder(s)`);
						return;
					}
					Object.keys(localeJson[key].placeholders).forEach((placeholder) => {
						if (!defaultLocaleJson[key].placeholders[placeholder]) {
							hasExtraPlaceholders = true;
							extraPlaceholders[locale].push(`${key}: ${placeholder}`);
						}
					});
				}
			});
		});
		if (hasExtraPlaceholders) {
			console.log('Error: extra placeholders were found. See them in `%s`', EXTRA_PLACEHOLDERS_FILE);
			recordResults(EXTRA_PLACEHOLDERS_FILE, extraPlaceholders);
			reject();
		} else {
			console.log('Scanned all locale files for extra placeholders, none found.');
			resolve();
		}
	});
}

/**
 * Checks for malformed placeholders in all the locale files. Writes the list of extra placeholders to a file
 * @param array   paths                        An array of strings denoting the paths to all the locale files
 * @const  string  MALFORMED_PLACEHOLDERS_FILE  The file where we should write the extra tokens
 * @return Promise                              Resolves if no extra tokens were found,
 *                                              Rejects otherwise
 */
function findMalformedPlaceholders(paths) {
	return new Promise((resolve, reject) => {
		let hasMalformedPlaceholders = false;
		const malformedPlaceholders = [];
		paths.forEach((path) => {
			const localeJson = jsonfile.readFileSync(`${path}`);
			const locale = path.match(/_locales\/(.*)\/messages.json/)[1];
			malformedPlaceholders[locale] = [];
			Object.keys(localeJson).forEach((key) => {
				const message = localeJson[key].message || '';
				const placeholders = localeJson[key].placeholders || {};
				const matchedPlaceholders = message.match(/\$[A-Z_]+\$/gi) || []; // Matches $PLACE_HOLDER$ in the message
				if (matchedPlaceholders) {
					matchedPlaceholders.forEach((p) => {
						const placeholder = p.toLowerCase().slice(1, -1);
						if (!placeholders.hasOwnProperty(placeholder)) {
							hasMalformedPlaceholders = true;
							malformedPlaceholders[locale].push(`${key}: needs placeholder "${placeholder}"`);
						}
					});
				}
				if (placeholders) {
					Object.keys(placeholders).forEach((p) => {
						const placeholder = `$${p.toUpperCase()}$`;
						if (matchedPlaceholders.indexOf(placeholder) === -1) {
							hasMalformedPlaceholders = true;
							malformedPlaceholders[locale].push(`${key}: expects placeholder "${placeholder}" in message`);
						}
					});
				}
			});
		});
		if (hasMalformedPlaceholders) {
			console.log('Error: malformed placeholders were found. See them in `%s`', MALFORMED_PLACEHOLDERS_FILE);
			recordResults(MALFORMED_PLACEHOLDERS_FILE, malformedPlaceholders);
			reject();
		} else {
			console.log('Scanned all locale files for malformed placeholders, none found.');
			resolve();
		}
	});
}

// Main
gatherFilePaths().then(paths => validateJson(paths)).then(paths => Promise.all([
	findDuplicates(paths),
	findMissingKeys(paths),
	findExtraKeys(paths),
	findMalformedKeys(paths),
	findMissingPlaceholders(paths),
	findExtraPlaceholders(paths),
	findMalformedPlaceholders(paths)
])).catch(() => {
	console.log('Errors found. Fix the files and run `node tools/i18n-checker` to re-validate locale files.');
}).then(() => {
	console.timeEnd('i18n-checker');
});
