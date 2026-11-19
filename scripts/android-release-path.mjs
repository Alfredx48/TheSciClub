import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(
  new URL('../android/app/build/outputs/bundle/release/app-release.aab', import.meta.url),
);
if (!statSync(bundle).isFile())
  throw new Error('Gradle did not produce an Android release bundle.');
console.log(bundle);
