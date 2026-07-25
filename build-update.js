import { execSync } from 'child_process';
import os from 'os';
import fs from 'fs';

const isLinux = os.platform() === 'linux';
const isWindows = os.platform() === 'win32';

console.log(`[Build-Update] Starting Tauri build on platform: ${os.platform()}`);

try {
  // Execute Tauri build
  execSync('npx tauri build', { stdio: 'inherit' });
  console.log('[Build-Update] Tauri build completed successfully.');

  if (isLinux) {
    const rpmSource = 'src-tauri/target/release/bundle/rpm/stockt-0.1.0-1.x86_64.rpm';
    if (fs.existsSync(rpmSource)) {
      console.log(`[Build-Update] Linux detected. Copying RPM package to project root...`);
      fs.copyFileSync(rpmSource, './stockt-0.1.0-1.x86_64.rpm');
      console.log('[Build-Update] Copied stockt-0.1.0-1.x86_64.rpm to project root.');
    } else {
      console.error(`[Build-Update] Error: RPM file not found at ${rpmSource}`);
    }
  } else if (isWindows) {
    const exeSource = 'src-tauri/target/release/stockt.exe';
    const dllSource = 'src-tauri/target/release/WebView2Loader.dll';
    
    if (fs.existsSync(exeSource)) {
      console.log(`[Build-Update] Windows detected. Copying stockt.exe to project root...`);
      fs.copyFileSync(exeSource, './stockt.exe');
      console.log('[Build-Update] Copied stockt.exe to project root.');
      
      if (fs.existsSync(dllSource)) {
        fs.copyFileSync(dllSource, './WebView2Loader.dll');
        console.log('[Build-Update] Copied WebView2Loader.dll to project root.');
      }
    } else {
      console.error(`[Build-Update] Error: stockt.exe not found at ${exeSource}`);
    }
  }
} catch (error) {
  console.error('[Build-Update] Error occurred during build or update:', error.message);
  process.exit(1);
}
