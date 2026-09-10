import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('🚀 Starting cPanel Deployment Build (CSS Fix)...');

try {
  console.log('📦 Running npm run build...');
  execSync('npm run build', { stdio: 'inherit' });
} catch (e) {
  console.error('❌ Build failed!');
  process.exit(1);
}

const STANDALONE_DIR = path.join(process.cwd(), '.next', 'standalone');
const TARGET_PUBLIC_DIR = path.join(STANDALONE_DIR, 'public');

// PASSENGER TRICK: cPanel Passenger automatically serves anything inside `public`.
// By placing our compiled Next.js static files into `public/_next/static`, 
// Passenger will bypass Node.js entirely and magically serve the CSS!
const TARGET_PASSENGER_STATIC = path.join(TARGET_PUBLIC_DIR, '_next', 'static');

const SOURCE_STATIC_DIR = path.join(process.cwd(), '.next', 'static');
const SOURCE_PUBLIC_DIR = path.join(process.cwd(), 'public');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

console.log('📁 Copying public folder...');
if (fs.existsSync(SOURCE_PUBLIC_DIR)) copyDir(SOURCE_PUBLIC_DIR, TARGET_PUBLIC_DIR);

console.log('🎨 Copying CSS/JS into Passenger static folder trick...');
if (fs.existsSync(SOURCE_STATIC_DIR)) copyDir(SOURCE_STATIC_DIR, TARGET_PASSENGER_STATIC);

const SERVER_JS = path.join(STANDALONE_DIR, 'server.js');
const APP_JS = path.join(STANDALONE_DIR, 'app.js');

if (fs.existsSync(SERVER_JS)) {
  let serverCode = fs.readFileSync(SERVER_JS, 'utf8');
  serverCode = serverCode.replace(
    /const currentPort = parseInt\(process\.env\.PORT, 10\) \|\| 3000/g,
    'const currentPort = process.env.PORT || 3000'
  );
  
  fs.writeFileSync(APP_JS, serverCode);
  fs.unlinkSync(SERVER_JS);
  console.log('✅ Patched app.js for 503 error.');
}

console.log('🎉 Done! Zip .next/standalone and upload to cPanel.');
