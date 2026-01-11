const express = require("express");
const bodyParser = require("body-parser");
const pool = require("./db"); // updated db.js for PostgreSQL
const client = require("prom-client");

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- MIDDLEWARE -------------------- */
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// CORS (frontend & backend separated)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // restrict in prod
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  next();
});

/* -------------------- PROMETHEUS METRICS -------------------- */
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpRequestDurationMicroseconds = new client.Histogram({
  name: "http_request_duration_ms",
  help: "Duration of HTTP requests in ms",
  labelNames: ["method", "route", "code"],
  buckets: [50, 100, 200, 300, 400, 500, 1000],
});
register.registerMetric(httpRequestDurationMicroseconds);
app.use((req, res, next) => {
  const end = httpRequestDurationMicroseconds.startTimer();
  res.on("finish", () => {
    end({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      code: res.statusCode,
    });
  });
  next();
});
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

/* -------------------- BASIC ENDPOINTS -------------------- */
app.get("/test", (req, res) => {
  res.json({ message: "Backend is working!" });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "healthy" });
  } catch (err) {
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

/* -------------------- AUTH -------------------- */
app.post("/signup", async (req, res) => {
  const { name, password } = req.body;

  if (!name || !password) {
    return res
      .status(400)
      .json({ status: "error", message: "Name and password are required" });
  }

  const balance = 500;
  const recharge_due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  try {
    const result = await pool.query(
      "INSERT INTO users (name, password, balance, recharge_due) VALUES ($1, $2, $3, $4) RETURNING id",
      [name, password, balance, recharge_due]
    );

    res.json({
      status: "success",
      message: "User registered successfully",
      userId: result.rows[0].id,
    });
  } catch (err) {
    console.log("Signup Error:", err);
    res.status(500).json({
      status: "error",
      message: "Signup failed. User might already exist.",
    });
  }
});

app.post("/login", async (req, res) => {
  const { name, password } = req.body;

  if (name === "admin" && password === "admin123") {
    return res.json({
      role: "admin",
      name: "admin",
      message: "Admin login successful",
    });
  }

  try {
    const result = await pool.query(
      "SELECT id, name, balance, recharge_due FROM users WHERE name=$1 AND password=$2",
      [name, password]
    );

    if (result.rows.length > 0) {
      res.json({
        role: "user",
        user: result.rows[0],
        message: "Login successful",
      });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.log("Login DB Error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/* -------------------- ADMIN -------------------- */
app.post("/add-channel", async (req, res) => {
  const { name, price } = req.body;

  if (!name || !price) {
    return res
      .status(400)
      .json({ error: "Channel name and price are required" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO channels (name, price) VALUES ($1, $2) RETURNING id",
      [name, parseInt(price)]
    );
    res.json({
      status: "success",
      message: "Channel added successfully",
      channelId: result.rows[0].id,
    });
  } catch (err) {
    console.log("Add Channel Error:", err);
    res.status(500).json({ error: "Failed to add channel" });
  }
});

app.get("/channels", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM channels");
    res.json(result.rows);
  } catch (err) {
    console.log("Get Channels Error:", err);
    res.status(500).json({ error: "Failed to fetch channels" });
  }
});

/* -------------------- USER -------------------- */
app.get("/user/:id", async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(
      "SELECT id, name, balance, recharge_due FROM users WHERE id=$1",
      [userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/subscribe", async (req, res) => {
  const { userId, channelId, price } = req.body;

  try {
    const subCheck = await pool.query(
      "SELECT * FROM user_channels WHERE user_id=$1 AND channel_id=$2",
      [userId, channelId]
    );

    if (subCheck.rows.length > 0)
      return res.status(400).json({ error: "Already subscribed to this channel" });

    const userResult = await pool.query("SELECT balance FROM users WHERE id=$1", [userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const userBalance = userResult.rows[0].balance;
    const channelPrice = parseInt(price);

    if (userBalance < channelPrice)
      return res.status(400).json({ error: "Insufficient balance" });

    await pool.query(
      "INSERT INTO user_channels (user_id, channel_id) VALUES ($1, $2)",
      [userId, channelId]
    );

    await pool.query(
      "UPDATE users SET balance = balance - $1 WHERE id = $2",
      [channelPrice, userId]
    );

    res.json({
      status: "success",
      message: "Channel subscribed successfully",
      newBalance: userBalance - channelPrice,
    });
  } catch (err) {
    console.log("Subscribe Error:", err);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

app.post("/unsubscribe", async (req, res) => {
  const { userId, channelId } = req.body;

  try {
    const result = await pool.query(
      "DELETE FROM user_channels WHERE user_id=$1 AND channel_id=$2",
      [userId, channelId]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Subscription not found" });

    res.json({ status: "success", message: "Channel unsubscribed successfully" });
  } catch (err) {
    console.log("Unsubscribe Error:", err);
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

app.get("/my-channels/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const result = await pool.query(
      `SELECT c.* FROM channels c
       JOIN user_channels uc ON c.id = uc.channel_id
       WHERE uc.user_id = $1`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.log("Get My Channels Error:", err);
    res.status(500).json({ error: "Failed to fetch your channels" });
  }
});

app.get("/balance/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const result = await pool.query(
      "SELECT balance, recharge_due FROM users WHERE id=$1",
      [userId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

/* -------------------- ERROR HANDLING -------------------- */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

app.get("/", (req, res) => {
  res.send("DTH Portal Backend is running 🚀");
});

/* -------------------- START SERVER -------------------- */
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Metrics: http://localhost:${PORT}/metrics`);
});
