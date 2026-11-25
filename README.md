# ✂ SnipURL — Production-Grade URL Shortener

> A full-stack URL shortening web app built with **Node.js**, **Express v5**, **MongoDB**, **Redis**, and **EJS** — featuring JWT authentication, bcrypt password hashing, rate limiting, Redis redirect caching, bot filtering, custom aliases, link expiry, QR codes, rich analytics, and a REST API.

---

## 📸 Features at a Glance

| Feature | Details |
|---|---|
| 🔗 URL Shortening | Shorten any `http://` or `https://` URL with duplicate-per-user protection & PRG reload safety |
| 🏷️ Custom Aliases | Optional 3–30 character slugs (`/url/my-brand`) with uniqueness validation |
| ⏳ Link Expiry | Optional expiration date per link — expired links return `410 Gone` |
| ✏️ Edit, Pause & Delete | Update destination URL (`POST /url/edit/:id`), pause/resume (`isActive`), or delete permanently |
| ⚡ Redis Caching | `ioredis` caches `shortId → redirectId` (with automatic invalidation on edit/toggle/delete and graceful fallback) |
| 🤖 Bot Filtering | Separates human clicks from bots/crawlers (`Googlebot`, `curl`, `Slackbot`, `WhatsApp`, etc.) |
| 📱 QR Code Generation | Server-side dark-themed QR code PNG on every link's analytics page with download |
| 🔍 Search, Sort & Pagination | Filter links by alias/URL (`?q=`), sort (`newest`, `oldest`, `most_clicked`), and paginate (`?page=`) |
| 🔑 Developer REST API | Per-user API keys (`Authorization: Bearer <key>`) for `/api/v1/*` endpoints |
| 🔐 JWT & bcrypt Auth | `bcryptjs` password hashing, stateless JWT in `httpOnly` `token` cookie, timing-safe login, logout |
| 🛡️ Security Hardening | `helmet` CSP/security headers, `express-rate-limit` on login/signup/shorten, global error handler |
| 📊 Rich Visitor Analytics | Country & city (`geoip-lite`), browser/OS/device (`ua-parser-js`), referrer, hashed IP, Chart.js graphs |
| 🧪 Automated Tests | 84 unit/schema tests + 14 HTTP integration tests + 12 Phase 4 & live Redis tests (`npm test`) |

---

## 🗂️ Project Structure

```
15_URL_Shortener_EJS_Authentication/
│
├── index.js                   # Entry point — dotenv, Helmet CSP, routes, Redis init, error handler, graceful shutdown
├── connection.js              # MongoDB connection via Mongoose
├── package.json               # Scripts: start (nodemon), test (unit + integration + phase4/redis)
├── .env                       # Environment config (ignored by git)
│
├── models/
│   ├── url.js                 # URL Schema (shortId, redirectId, expiresAt, isActive, visitHistory + isBot)
│   └── user.js                # User Schema (name, email, hashed password, apiKeyHash, apiKeyPrefix)
│
├── controllers/
│   ├── url.js                 # Shorten, Redis-cached redirect + bot/geo/UA telemetry, analytics + QR, edit, toggle, delete
│   └── user.js                # Signup (bcrypt), login (JWT httpOnly cookie), logout, API key generate/revoke
│
├── routes/
│   ├── staticroute.js         # GET / (search, sort, pagination), /login, /signup
│   ├── url.js                 # POST /url, GET /url/analytics/:id, POST /url/edit/:id, toggle, delete, GET /url/:id
│   ├── user.js                # POST /user, POST /user/login, GET /user/logout, POST /user/api-key(/revoke)
│   └── api.js                 # REST API v1 (/api/v1/shorten, /links, /analytics/:id)
│
├── middlewares/
│   ├── auth.js                # restrictToLoggedInUserOnly, checkAuth (reads JWT token cookie)
│   ├── apiAuth.js             # authenticateApiKey (SHA-256 lookup from Bearer / x-api-key)
│   └── rateLimiter.js         # loginLimiter (10/15m), signupLimiter (5/hr), urlShortenLimiter (30/15m)
│
├── service/
│   ├── auth.js                # Stateless JWT sign & verify (setUser / getUser)
│   └── cache.js               # Redis caching layer (getCachedUrl, setCachedUrl, delCachedUrl)
│
├── views/                     # EJS templates
│   ├── home.ejs               # Dashboard — shorten form, search/sort/pagination, links table, API key panel
│   ├── analytics.ejs          # Human vs bot stats, edit destination, QR code, Chart.js graphs, leaderboards
│   ├── login.ejs              # Login form with error & registration success banners
│   ├── signup.ejs             # Signup form with validation error banner
│   └── error.ejs              # Friendly error page (400, 403, 404, 410, 500)
│
└── tests/
    ├── phase2.test.js         # 84 unit & schema validation tests
    ├── integration.test.js    # 14 in-process HTTP integration tests
    └── phase4.test.js         # 12 Phase 4 + live Docker Redis cache hit/invalidation tests
```

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (v18+) |
| Framework | Express.js v5 |
| Database & Cache | MongoDB + Mongoose v8, Redis (`ioredis`) |
| View Engine | EJS v6 + Chart.js v4 (CDN) |
| Auth & Security | `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit`, `dotenv` |
| Analytics & QR | `ua-parser-js`, `geoip-lite`, `qrcode`, `shortid` |

---

## ⚙️ Setup & Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [MongoDB](https://www.mongodb.com/try/download/community) running locally on port `27017`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (optional, for Redis caching — app falls back gracefully if Redis is unavailable)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Hetshah573/SnipURL-URL-Shortener.git
cd SnipURL-URL-Shortener

# 2. Install dependencies
npm install

# 3. Start Redis via Docker (recommended)
docker run -d --name snipurl-redis -p 6379:6379 --restart unless-stopped redis:alpine

# 4. Create a .env file in the project root
PORT=5000
MONGO_URI=mongodb://localhost:27017/short-url
JWT_SECRET=replace_with_a_long_random_secret_string
JWT_EXPIRES_IN=7d
REDIS_URL=redis://localhost:6379

# 5. Run the test suite
npm test

# 6. Start the development server
npm start
```

Open `http://localhost:5000` in your browser.

---

## 🌐 Route & REST API Reference

### Web Routes
| Method | Path | Auth | Rate Limit | Description |
|---|---|---|---|---|
| `GET` | `/` | ✅ Cookie | — | Dashboard (`?q=`, `?sort=`, `?page=`) |
| `GET` | `/login`, `/signup` | ❌ | — | Auth pages |
| `POST` | `/user`, `/user/login` | ❌ | 5/hr, 10/15m | Signup (bcrypt) & Login (`httpOnly` JWT) |
| `GET` | `/user/logout` | ❌ | — | Clear auth cookie |
| `POST` | `/user/api-key`, `/user/api-key/revoke` | ✅ Cookie | — | Generate/regenerate or revoke API key |
| `POST` | `/url` | ✅ Cookie | 30/15m | Create short URL (PRG redirect to `/?created=`) |
| `GET` | `/url/:id` | ❌ Public | — | Redis-cached redirect + bot/geo/UA telemetry |
| `GET` | `/url/analytics/:id` | ✅ Owner | — | Analytics dashboard, QR code, & edit form |
| `POST` | `/url/edit/:id` | ✅ Owner | — | Update destination URL & invalidate Redis |
| `POST` | `/url/toggle/:id` | ✅ Owner | — | Pause/resume link & invalidate Redis |
| `POST` | `/url/delete/:id` | ✅ Owner | — | Delete link & invalidate Redis |

### Developer REST API (`/api/v1`)
Authenticate with `Authorization: Bearer <your_api_key>` or `x-api-key: <your_api_key>`:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/shorten` | Create short link (`{ url, customAlias?, expiresAt? }`) |
| `GET` | `/api/v1/links` | List links with `?q=`, `?sort=`, `?page=`, `?limit=` |
| `GET` | `/api/v1/analytics/:id` | JSON analytics (`humanClicks`, `botClicks`, `uniqueClicks`, breakdowns) |
| `PATCH` | `/api/v1/links/:id` | Edit destination URL (`{ redirectId }`) + clear cache |
| `DELETE` | `/api/v1/links/:id` | Delete link + clear cache |

---

## 🧪 Running Tests

```bash
npm test
```

Runs all **110 tests** across 3 suites:
1. `tests/phase2.test.js` — 84 unit & schema tests
2. `tests/integration.test.js` — 14 in-process HTTP integration tests
3. `tests/phase4.test.js` — 12 Phase 4 + live Docker Redis cache-hit & invalidation tests

---

## 📄 License

This project is for educational purposes. Feel free to fork and extend it.
