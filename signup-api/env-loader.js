'use strict';

const fs = require('fs');

function parseValue(raw) {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
  }
  return value;
}

function loadEnvFile(filePath, target = process.env) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { loaded: 0, skippedExisting: 0 };
    throw error;
  }

  let loaded = 0;
  let skippedExisting = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      skippedExisting += 1;
      continue;
    }
    target[key] = parseValue(match[2]);
    loaded += 1;
  }
  return { loaded, skippedExisting };
}

module.exports = { loadEnvFile };
