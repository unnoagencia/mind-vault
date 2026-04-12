import AdmZip from 'adm-zip';
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'skills/using-mind-vault';
const OUT_DIR = 'assets';
const OUT = join(OUT_DIR, 'using-mind-vault.zip');

function addDir(zip: AdmZip, dir: string, base: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) addDir(zip, full, base);
    else zip.addLocalFile(full, relative(base, dir));
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const zip = new AdmZip();
addDir(zip, SRC, SRC);
zip.writeZip(OUT);
console.log(`Wrote ${OUT}`);
