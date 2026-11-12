// Starts the mock courier and the service together: `npm start`.
const { spawn } = require('node:child_process');

const children = ['mock-courier.js', 'src/index.js'].map((file) =>
  spawn(process.execPath, [file], { stdio: 'inherit' }),
);

function stopAll(code = 0) {
  for (const child of children) child.kill();
  process.exit(code);
}

process.on('SIGINT', () => stopAll());
process.on('SIGTERM', () => stopAll());
for (const child of children) child.on('exit', (code) => stopAll(code ?? 1));
