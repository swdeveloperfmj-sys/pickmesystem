import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Store-only ZIP: no build dependency or platform-specific archiver required.
const source = new URL("../../extensions/pickme-booking/", import.meta.url);
const output = new URL("../public/downloads/", import.meta.url);
const bundledArchive = new URL("ctms-pickme-booking.zip", output);
const files = ["manifest.json", "background.js", "bridge.js", "pickme.js", "README.md"];
if (!existsSync(source)) {
  if (!existsSync(bundledArchive))
    throw new Error("Extension sources and the bundled extension ZIP are both missing.");
  console.warn("Extension sources are unavailable; keeping the bundled extension ZIP.");
} else {
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const entries = [], directory = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file);
    const data = await readFile(new URL(file, source));
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(33, 12); // 1980-01-01, deterministic archive timestamp.
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    entries.push(header, name, data);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const centralData = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  await mkdir(output, { recursive: true });
  await writeFile(bundledArchive, Buffer.concat([...entries, centralData, end]));
  console.log("Packaged CTMS PickMe Booking Helper (5 files).");
}
