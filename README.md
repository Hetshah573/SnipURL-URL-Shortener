# ✂ SnipURL — Production-Grade URL Shortener

> A full-stack URL shortening web app built with **Node.js**, **Express v5**, **MongoDB**, and **EJS** — featuring JWT authentication, bcrypt password hashing, rate limiting, custom aliases, link expiry, QR codes, and rich visitor analytics.

---

## 📸 Features at a Glance

| Feature | Details |
|---|---|
| 🔗 URL Shortening | Paste any `http://` or `https://` URL and get a short link (`shortid`) or custom slug |
| 🏷️ Custom Aliases | Optional 3–30 character slugs (`/url/my-brand`) with uniqueness validation |
| ⏳ Link Expiry | Optional expiration date per link — expired links return `410 Gone` |
| ⏸️ Pause / Resume & Delete | Toggle links active/paused (`isActive`) or delete them permanently from dashboard/analytics |
| 📱 QR Code Generation | Server-side dark-themed QR code PNG on every link's analytics page with download |
| 🔐 JWT & bcrypt Auth | `bcryptjs` password hashing, stateless JWT in `httpOnly` `token` cookie, timing-safe login, logout |
| 🛡️ Security Hardening | `helmet` CSP/security headers, `express-rate-limit` on login/signup/shorten, global error handler |
| 📊 Rich Visitor Analytics | Tracks country & city (`geoip-lite`), browser/OS/device (`ua-parser-js`), referrer, and hashed IP |
| 📈 Interactive Charts | 7-day click bar chart & device breakdown doughnut chart via Chart.js + leaderboards |
| 🧪 Automated Tests | 84 unit/schema tests + 12 HTTP integration tests via `npm test` |

---

## 🗂️ Project Structure

```
15_URL_Shortener_EJS_Authentication/
│
├── index.js                   # Entry point — dotenv, Helmet CSP, routes, error handler, graceful shutdown
├── connection.js              # MongoDB connection via Mongoose
├── package.json               # Scripts: start (nodemon), test (unit + integration)
├── .env                       # Environment config (ignored by git)
│
├── models/
│   ├── url.js                 # URL Schema (shortId, redirectId, expiresAt, isActive, enriched visitHistory)
│   └── user.js                # User Schema (name, email, hashed password)
│
├── controllers/
│   ├── url.js                 # Shorten, public redirect + telemetry, analytics + QR, toggle, delete
│   └── user.js                # Signup (bcrypt), login (JWT httpOnly cookie), logout
│
├── routes/
│   ├── staticroute.js         # GET /, /login, /signup, /Signup → /signup
│   ├── url.js                 # POST /url, GET /url/analytics/:id, POST /url/toggle/:id, POST /url/delete/:id, GET /url/:id
│   └── user.js                # POST /user, POST /user/login, GET /user/logout
│
├── middlewares/
│   ├── auth.js                # restrictToLoggedInUserOnly, checkAuth (reads JWT token cookie)
│   └── rateLimiter.js         # loginLimiter (10/15m), signupLimiter (5/hr), urlShortenLimiter (30/15m)
│
├── service/
│   └── auth.js                # Stateless JWT sign & verify (setUser / getUser)
│
├── views/                     # EJS templates
│   ├── home.ejs               # Dashboard — shorten form, advanced options, links table, actions
│   ├── analytics.ejs          # Charts, QR code, unique visitors, country/browser/OS/referrer breakdown
│   ├── login.ejs              # Login form with error & registration success banners
│   ├── signup.ejs             # Signup form with validation error banner
│   └── error.ejs              # Friendly error page (403, 404, 410, 500)
│
└── tests/
    ├── phase2.test.js         # 84 unit & schema validation tests
    └── integration.test.js    # 12 in-process HTTP integration tests (routes, cookies, EJS, telemetry)
```

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (v18+) |
| Framework | Express.js v5 |
| Database & ODM | MongoDB + Mongoose v8 |
| View Engine | EJS v6 + Chart.js v4 (CDN) |
| Auth & Security | `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit`, `dotenv` |
| Analytics & QR | `ua-parser-js`, `geoip-lite`, `qrcode`, `shortid` |

---

## ⚙️ Setup & Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [MongoDB](https://www.mongodb.com/try/download/community) running locally on port `27017` (or a remote MongoDB URI)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Hetshah573/SnipURL-URL-Shortener.git
cd SnipURL-URL-Shortener

# 2. Install dependencies
npm install

# 3. Create a .env file in the project root
PORT=5000
MONGO_URI=mongodb://localhost:27017/short-url
JWT_SECRET=replace_with_a_long_random_secret_string
JWT_EXPIRES_IN=7d

# 4. Run the test suite
npm test

# 5. Start the development server
npm start
```

Open `http://localhost:5000` in your browser.

---

## 🌐 Route Reference

### Static Routes
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | ✅ Required | Home dashboard — shows all user's links |
| `GET` | `/login` | ❌ | Login page (redirects to `/` if already logged in) |
| `GET` | `/signup` | ❌ | Signup page (`/Signup` redirects here) |

### User Routes (`/user`)
| Method | Path | Auth | Rate Limit | Description |
|---|---|---|---|---|
| `POST` | `/user` | ❌ | 5 / hour | Create account (hashes password with bcrypt) |
| `POST` | `/user/login` | ❌ | 10 / 15 min | Verify credentials & set `httpOnly` JWT `token` cookie |
| `GET` | `/user/logout` | ❌ | — | Clear `token` cookie & redirect to `/login` |

### URL Routes (`/url`)
| Method | Path | Auth | Rate Limit | Description |
|---|---|---|---|---|
| `POST` | `/url` | ✅ Required | 30 / 15 min | Shorten URL (supports `customAlias` & `expiresAt`) |
| `GET` | `/url/:id` | ❌ Public | — | Redirect to original URL (`404` if paused/missing, `410` if expired) + record visitor telemetry |
| `GET` | `/url/analytics/:id` | ✅ Owner only | — | Render analytics dashboard, QR code, & charts (`403` if not owner) |
| `POST` | `/url/toggle/:id` | ✅ Owner only | — | Pause or resume link (`isActive`) |
| `POST` | `/url/delete/:id` | ✅ Owner only | — | Permanently delete link |

---

## 🗃️ Database Schema

### `urls` Collection
```js
{
  shortId:      String,   // Unique short ID or custom alias
  redirectId:   String,   // Original http/https URL
  expiresAt:    Date,     // Optional expiry timestamp (null = permanent)
  isActive:     Boolean,  // Active/paused toggle (default: true)
  visitHistory: [{
    timestamps: Number,   // Unix ms
    ip:         String,   // 16-char SHA-256 hash of visitor IP
    country:    String,   // Country code (via geoip-lite)
    city:       String,   // City name
    browser:    String,   // Browser name (via ua-parser-js)
    os:         String,   // Operating system
    device:     String,   // Desktop | Mobile | Tablet | Other
    referrer:   String    // Referer header or "(direct)"
  }],
  createdBy:    ObjectId, // Reference to user._id
  createdAt:    Date,
  updatedAt:    Date
}
```

### `users` Collection
```js
{
  name:      String,
  email:     String,  // Unique
  password:  String,  // bcrypt hash
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🧪 Running Tests

```bash
npm test
```

Runs:
1. `node tests/phase2.test.js` — 84 unit & schema tests
2. `node tests/integration.test.js` — 12 in-process HTTP integration tests (auth, custom alias, expiry, pause/delete, public redirect, telemetry, and analytics rendering)

---

## 📄 License

This project is for educational purposes. Feel free to fork and extend it.
