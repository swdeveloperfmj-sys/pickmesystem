import "dotenv/config";
import mongoose from "mongoose";
import { readConfig } from "./config.js";
import { initializeDatabase, SetupState } from "./models.js";
import { createMailer } from "./mail.js";
import { createApp } from "./app.js";

try {
  const config = readConfig();
  await mongoose.connect(config.MONGODB_URI);
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== "isdbgrid")
    throw new Error(
      "MongoDB must be a replica set or sharded cluster for atomic setup transactions.",
    );
  await initializeDatabase();
  const mailer = createMailer(config);
  await mailer.verify();
  console.log(
    (await SetupState.exists({ _id: "super-admin" }))
      ? "Super Admin setup is closed."
      : "Super Admin initial setup is required.",
  );
  const server = createApp({ config, mailer }).listen(config.PORT, () =>
    console.log(`CTMS API listening on port ${config.PORT}`),
  );
  const shutdown = () =>
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (error) {
  // Configuration validation errors may include secrets; print field names only.
  console.error(
    "Startup failed:",
    error.issues
      ? error.issues.map((issue) => issue.path.join(".")).join(", ")
      : error.name,
  );
  await mongoose.disconnect();
  process.exitCode = 1;
}
