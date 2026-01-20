import express from "express";
import { initializeDatabase, closeDatabase } from "./db/index.js";
import statementsRouter from "./routes/statements.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.redirect("/statements");
});

app.use("/statements", statementsRouter);

function shutdown() {
  console.log("\nShutting down...");
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
} catch (error) {
  console.error("Failed to start server:", error);
  process.exit(1);
}
