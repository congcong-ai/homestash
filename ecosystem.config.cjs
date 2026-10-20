module.exports = {
  apps: ["core", "web"].map((role) => ({
    name: `homestash-${role}`,
    cwd: "/var/www/homestash/current",
    script: "scripts/native-service.mjs",
    args: role,
    interpreter: "node",
    kill_timeout: 10000,
    max_memory_restart: role === "web" ? "512M" : "384M",
    out_file: `/var/www/homestash/shared/logs/${role}.out.log`,
    error_file: `/var/www/homestash/shared/logs/${role}.err.log`,
    env: { NODE_ENV: "production" },
  })),
};
