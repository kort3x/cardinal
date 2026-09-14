import { startStaticServer } from "../server.js";

startStaticServer({
  port: 4174,
  entry: "examples/card-engine-use/index.html",
  label: "Cardinal example consumer",
});
