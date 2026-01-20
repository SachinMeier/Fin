import express from "express";
import { initializeDatabase, closeDatabase } from "./db/index.js";
import statementsRouter from "./routes/statements.js";
import categoriesRouter from "./routes/categories.js";
import vendorsRouter from "./routes/vendors.js";
import rulesRouter from "./routes/rules.js";
import { renderHomePage } from "./templates/home.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.send(renderHomePage());
});

app.use("/statements", statementsRouter);
app.use("/categories", categoriesRouter);
app.use("/vendors", vendorsRouter);
app.use("/rules", rulesRouter);

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
