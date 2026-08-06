module.exports = {
  apps: [
    {
      name: "pokedex-bot",
      cwd: "/opt/pokedex",
      script: "server/bot.js",
      interpreter: "/root/.nvm/versions/node/v22.23.1/bin/node",
      env: {
        NODE_ENV: "production"
      },
      out_file: "/opt/pokedex/logs/pokedex-bot-out.log",
      error_file: "/opt/pokedex/logs/pokedex-bot-error.log",
      merge_logs: true,
      max_memory_restart: "350M",
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      time: true
    },
    {
      name: "pokedex-overlay",
      cwd: "/opt/pokedex",
      script: "overlay-server-v8.js",
      interpreter: "/root/.nvm/versions/node/v22.23.1/bin/node",
      env: {
        NODE_ENV: "production"
      },
      out_file: "/opt/pokedex/logs/pokedex-overlay-out.log",
      error_file: "/opt/pokedex/logs/pokedex-overlay-error.log",
      merge_logs: true,
      max_memory_restart: "250M",
      restart_delay: 3000,
      autorestart: true,
      watch: false,
      time: true
    },
    {
      name: "pokedex-web-sync",
      cwd: "/opt/pokedex",
      script: "server/web-sync.js",
      interpreter: "/root/.nvm/versions/node/v22.23.1/bin/node",
      env: {
        NODE_ENV: "production"
      },
      out_file: "/opt/pokedex/logs/pokedex-web-sync-out.log",
      error_file: "/opt/pokedex/logs/pokedex-web-sync-error.log",
      merge_logs: true,
      max_memory_restart: "150M",
      restart_delay: 10000,
      autorestart: true,
      watch: false,
      time: true
    }
  ]
};
