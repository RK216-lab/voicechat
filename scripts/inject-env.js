// scripts/inject-env.js
// VercelのBuild Commandで実行: node scripts/inject-env.js
// 環境変数から public/js/env.js を生成する
import fs from 'fs';
import path from 'path';

const env = {
  VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || "",
  VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || "",
  VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID || "",
  VITE_FIREBASE_MEASUREMENT_ID: process.env.VITE_FIREBASE_MEASUREMENT_ID || "",
};

const outDir = path.join(process.cwd(), 'js');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const content = `// このファイルはVercelビルド時に自動生成されます。手動編集しない
window.__ENV__ = ${JSON.stringify(env, null, 2)};
`;

fs.writeFileSync(path.join(outDir, 'env.js'), content);
console.log('✅ js/env.js generated from Vercel env vars');
console.log(env);
