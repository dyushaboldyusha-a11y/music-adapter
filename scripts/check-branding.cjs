const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit');
const pkg = require('../package.json');

const icon = Data.IconFile.from(fs.readFileSync(path.join(__dirname, '../build/icon.ico')));
const expectedPng = Buffer.from(icon.icons.find(item => item.data.width === 256).data.bin);
const files = process.argv.slice(2);
if (!files.length) files.push(`release/win-unpacked/${pkg.productName}.exe`, `release/Liberty-Wave-${pkg.version}-Windows.exe`);
for (const filename of files) {
  const executable = NtExecutable.from(fs.readFileSync(filename));
  const resource = NtExecutableResource.from(executable);
  const versions = Resource.VersionInfo.fromEntries(resource.entries);
  const strings = versions.flatMap(info => info.getAllLanguagesForStringValues().map(lang => info.getStringValues(lang)));
  assert.ok(strings.some(values => values.ProductName === pkg.productName), `${filename}: product name is missing`);
  assert.ok(strings.some(values => values.FileDescription?.includes(pkg.productName)), `${filename}: description is missing`);
  assert.ok(resource.entries.some(entry => entry.type === 3 && Buffer.from(entry.bin).equals(expectedPng)), `${filename}: supplied 256px icon was not embedded`);
  const groups = Resource.IconGroupEntry.fromEntries(resource.entries);
  assert.ok(groups.some(group => [16, 32, 48].every(size => group.icons.some(icon => icon.width === size))), `${filename}: small shell icons are missing`);
  console.log(`PASS: ${filename} contains the Liberty Wave name and supplied multi-size icon.`);
}
