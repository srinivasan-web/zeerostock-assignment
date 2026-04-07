const initializeDatabase = require("./init");
const app = require("./server-fixed");

async function bootstrap() {
  await initializeDatabase();
  return app.startServer();
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = app.startServer;
module.exports.bootstrap = bootstrap;
