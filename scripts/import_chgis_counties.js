#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FILE_BASE = 'v6_time_cnty_pts_utf_wgs84';
const OUTPUT = path.join(ROOT, 'data/local/county-points.json');

function readCounties(dbf, shp) {
  if (dbf.length < 33 || dbf[0] !== 3) throw new Error('Unsupported or truncated DBF file');
  const count = dbf.readUInt32LE(4);
  const headerSize = dbf.readUInt16LE(8);
  const recordSize = dbf.readUInt16LE(10);
  if (headerSize < 33 || headerSize + count * recordSize > dbf.length) {
    throw new Error('Invalid DBF header or truncated records');
  }
  const fields = new Map();
  let offset = 1;
  for (let i = 32; i < headerSize && dbf[i] !== 13; i += 32) {
    if (i + 32 > headerSize) throw new Error('Invalid DBF field descriptor');
    const name = dbf.subarray(i, i + 11).toString('ascii').replace(/\0.*$/, '');
    const length = dbf[i + 16];
    fields.set(name, { offset, length });
    offset += length;
  }
  if (offset > recordSize || dbf[headerSize - 1] !== 13) throw new Error('Invalid DBF field layout');
  for (const name of ['NAME_CH', 'NAME_FT', 'NAME_PY', 'BEG_YR', 'END_YR', 'SYS_ID']) {
    if (!fields.has(name)) throw new Error(`Missing DBF field ${name}`);
  }
  if (shp.length < 100 || shp.readInt32BE(0) !== 9994 || shp.readInt32LE(32) !== 1 ||
      shp.readInt32BE(24) * 2 !== shp.length) {
    throw new Error('Expected a complete point shapefile');
  }
  const points = [];
  const rejected = [];
  let shapeOffset = 100;
  for (let i = 0; i < count; i++) {
    if (shapeOffset + 8 > shp.length) throw new Error('Shapefile has fewer records than the DBF');
    const shapeLength = shp.readInt32BE(shapeOffset + 4) * 2;
    const shapeStart = shapeOffset + 8;
    if (shapeLength < 4 || shapeStart + shapeLength > shp.length) throw new Error('Invalid shapefile record');
    const shapeType = shp.readInt32LE(shapeStart);
    if (shapeType !== 0 && (shapeType !== 1 || shapeLength !== 20)) throw new Error('Expected point geometry');
    const lon = shapeType === 1 ? shp.readDoubleLE(shapeStart + 4) : NaN;
    const lat = shapeType === 1 ? shp.readDoubleLE(shapeStart + 12) : NaN;
    shapeOffset = shapeStart + shapeLength;
    const start = headerSize + i * recordSize;
    if (dbf[start] === 0x2a) continue;
    const get = (name) => {
      const field = fields.get(name);
      return dbf.subarray(start + field.offset, start + field.offset + field.length).toString('utf8').trim();
    };
    const name = get('NAME_CH');
    const beginText = get('BEG_YR');
    const endText = get('END_YR');
    const begin = Number(beginText);
    const end = Number(endText);
    if (
      !name || !beginText || !endText ||
      !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90 ||
      !Number.isInteger(begin) || !Number.isInteger(end) || begin > end || begin < -1000 || end > 2100
    ) {
      rejected.push(`${get('SYS_ID')}: ${name} (${beginText}–${endText})`);
      continue;
    }
    points.push([name, get('NAME_FT'), get('NAME_PY'), lon, lat, begin, end]);
  }
  if (shapeOffset !== shp.length) throw new Error('Shapefile has more records than the DBF');
  if (!points.length) throw new Error('No valid county records found');
  return { points, rejected };
}

if (require.main === module) {
  try {
    const archive = process.argv[2];
    if (!archive || process.argv.length !== 3) {
      throw new Error('Usage: node scripts/import_chgis_counties.js /path/to/v6_time_cnty_pts_utf_wgs84.zip');
    }
    const extract = (extension) => execFileSync('unzip', ['-p', path.resolve(archive), `${FILE_BASE}.${extension}`], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const { points, rejected } = readCounties(extract('dbf'), extract('shp'));
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(points));
    console.log(`Imported ${points.length} county-level records into ${OUTPUT}`);
    if (rejected.length) console.warn(`Excluded ${rejected.length} invalid records:\n${rejected.join('\n')}`);
    console.log('CHGIS data is for local permitted use only; do not redistribute this file.');
  } catch (error) {
    console.error(`County import failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { readCounties };
