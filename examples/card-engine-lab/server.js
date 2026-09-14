import { startStaticServer } from "../server.js";

startStaticServer({
  port: 4173,
  entry: "examples/card-engine-lab/index.html",
  label: "Cardinal lab",
});
