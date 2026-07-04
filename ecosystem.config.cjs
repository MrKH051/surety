// pm2 process file — keeps Surety alive 24/7 on a VPS.
//
//   npm i -g pm2
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup     (auto-restart after a server reboot)
module.exports = {
  apps: [
    {
      name: 'surety',
      script: 'npm',
      args: 'start',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
