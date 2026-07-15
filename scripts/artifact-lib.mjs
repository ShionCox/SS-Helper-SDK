import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(file) {
  return sha256(readFileSync(file));
}

export function walkFiles(root) {
  const result = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      if (statSync(absolute).isDirectory()) visit(absolute);
      else result.push(path.relative(root, absolute).replaceAll('\\', '/'));
    }
  };
  visit(root);
  return result;
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createDeterministicZip(root, outputFile) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const relative of walkFiles(root)) {
    const name = Buffer.from(relative, 'utf8');
    const contents = readFileSync(path.join(root, ...relative.split('/')));
    const checksum = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x2821, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, contents);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2821, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + contents.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const fileCount = centralParts.length / 2;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(fileCount, 8);
  end.writeUInt16LE(fileCount, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFileSync(outputFile, Buffer.concat([...localParts, centralDirectory, end]));
  return outputFile;
}

export function inventory(root, excluded = new Set()) {
  return walkFiles(root)
    .filter((relative) => !excluded.has(relative))
    .map((relative) => {
      const absolute = path.join(root, ...relative.split('/'));
      return Object.freeze({
        path: relative,
        size: statSync(absolute).size,
        sha256: sha256File(absolute),
      });
    });
}

export function contentDigest(files) {
  const canonical = [...files]
    .map(({ path: filePath, sha256: digest }) => ({ path: filePath, sha256: digest.toLowerCase() }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const hash = createHash('sha256');
  for (const file of canonical) hash.update(`${file.path}\0${file.sha256}\n`, 'utf8');
  return hash.digest('hex');
}

export function verifyInventory(root, manifest) {
  const actual = inventory(root, new Set(['artifact-manifest.json']));
  const expected = [...manifest.files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Core artifact inventory does not match artifact-manifest.json');
  }
  const digest = contentDigest(actual);
  if (digest !== manifest.contentDigest) throw new Error('Core artifact contentDigest mismatch');
  return actual;
}

export function rewriteSdkImports(source, outputFile, sdkRoot) {
  return source.replace(/(['"])@ss-helper\/sdk(?:\/([^'"]+))?\1/gu, (_match, quote, subpath) => {
    const target = path.join(sdkRoot, subpath === undefined ? 'index.js' : `${subpath}.js`);
    let relative = path.relative(path.dirname(outputFile), target).replaceAll('\\', '/');
    if (!relative.startsWith('.')) relative = `./${relative}`;
    return `${quote}${relative}${quote}`;
  });
}
