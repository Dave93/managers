require("dotenv").config();
module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME,
      script: "nvm exec 18.17.0 npm",
      args: "run start",
      env: {
        PORT: 3000,
        NODE_ENV: "development",
      },
      env_production: {
        PORT: process.env.NODE_PORT,
        NODE_ENV: "production",
      },
    },
  ],
};
