const app = require("./server-fixed");

if (require.main === module) {
  app.startServer();
}

module.exports = app;
module.exports.startServer = app.startServer;
