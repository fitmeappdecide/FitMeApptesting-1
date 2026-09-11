const path = require("path");
module.exports = { entry: "./src/fitme-widget.js", output: { filename: "fitme-widget.js", path: path.resolve(__dirname, "dist"), library: "FitMeWidget" } };

