const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const targets = new Set([
	'darwin-arm64',
	'darwin-x64',
	'linux-arm64-gnu',
	'linux-x64-gnu',
]);

function currentTarget() {
	if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
	if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64';
	if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64-gnu';
	if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64-gnu';
	throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
}

const argument = process.argv.find((value) => value.startsWith('--target='));
const target = argument?.slice('--target='.length) ?? currentTarget();

if (!targets.has(target)) {
	throw new Error(`Unsupported package target: ${target}`);
}

const binaryName = `cliweb-native-rs.${target}.node`;
const source = path.join(packageRoot, binaryName);
const destinationDirectory = path.join(packageRoot, 'npm', target);
const destination = path.join(destinationDirectory, binaryName);
const license = path.join(packageRoot, 'LICENSE.txt');

if (!existsSync(source)) {
	throw new Error(`Build ${binaryName} before staging the platform package`);
}

mkdirSync(destinationDirectory, { recursive: true });
copyFileSync(source, destination);
copyFileSync(license, path.join(destinationDirectory, 'LICENSE.txt'));
console.log(destination);
