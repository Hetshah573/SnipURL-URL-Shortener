# ✂ SnipURL — URL Shortener with Authentication

> A full-stack URL shortening web app built with **Node.js**, **Express**, **MongoDB**, and **EJS** — featuring session-based authentication, per-user link management, and click analytics.

---

## 📸 Features at a Glance

| Feature | Details |
|---|---|
| 🔗 URL Shortening | Paste any long URL and get a compact short link |
| 🔐 User Auth | Sign up / Log in with session-based authentication (cookie + in-memory store) |
| 👤 Private Links | Each user only sees and manages their own shortened links |
| 📊 Click Tracking | Every redirect is timestamped and total click counts are shown per link |
| 🕒 Created-at Dates | Each link records when it was created (via Mongoose timestamps) |
| ⚡ Instant Redirect | Visiting `localhost:5000/url/:id` redirects the browser to the original URL |
| 🧩 MVC Architecture | Clean separation of models, controllers, routes, services, and middlewares |

---

## 🗂️ Project Structure

```
15_URL_Shortener_EJS_Authentication/
│
├── index.js                   # App entry point — mounts routes & starts server
├── connection.js              # MongoDB connection via Mongoose
├── package.json
│
├── models/
│   ├── url.js                 # URL Schema (shortId, redirectId, visitHistory, createdBy)
│   └── user.js                # User Schema (name, email, password)
│
├── controllers/
│   ├── url.js                 # Handlers: generate short URL, redirect, analytics
│   └── user.js                # Handlers: signup, login
│
├── routes/
│   ├── staticroute.js         # GET /  → home dashboard (auth-checked)
│   ├── url.js                 # POST /url, GET /url/:id, GET /url/analytics/:id
│   └── user.js                # POST /user (signup), POST /user/login
│
├── middlewares/
│   └── auth.js                # restrictToLoggedInUserOnly, checkAuth
│
├── service/
│   └── auth.js                # In-memory session store (Map)
│
└── views/                     # EJS templates
    ├── home.ejs               # Dashboard — shorten form + links table
    ├── login.ejs              # Login form
    ├── signup.ejs             # Signup form
    └── analytics.ejs          # Per-link analytics page (clicks + visit timestamps)
```

---

## 🏗️ Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                        │
└───────────────────────┬─────────────────────────────────────────┘
                        │  HTTP Request (+ uid cookie)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Express Server (index.js)                  │
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                     Middleware Stack                     │  │
│   │  express.json()  ·  express.urlencoded()  ·  cookieParser│  │
│   └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│         ┌────────────────────┼─────────────────────┐           │
│         ▼                    ▼                     ▼           │
│  ┌─────────────┐   ┌──────────────────┐   ┌─────────────┐     │
│  │  /user      │   │  /  (static)     │   │  /url       │     │
│  │  routes     │   │  staticroute.js  │   │  routes     │     │
│  └──────┬──────┘   └────────┬─────────┘   └──────┬──────┘     │
│         │                   │  checkAuth          │            │
│         │             auth middleware   restrictToLoggedIn     │
│         ▼                   ▼                     ▼           │
│  ┌─────────────┐   ┌──────────────────┐   ┌─────────────┐     │
│  │   user      │   │  Render home.ejs │   │   url       │     │
│  │ controller  │   │  (urls + name)   │   │ controller  │     │
│  └──────┬──────┘   └──────────────────┘   └──────┬──────┘     │
└─────────┼──────────────────────────────────────── ┼ ──────────┘
          │                                         │
          ▼                                         ▼
┌─────────────────────┐                 ┌───────────────────────┐
│    service/auth.js  │                 │     MongoDB via        │
│  (In-memory Map)    │                 │     Mongoose ORM       │
│  sessionId → user   │                 │  ┌─────────┐          │
└─────────────────────┘                 │  │  URLs   │          │
                                        │  ├─────────┤          │
                                        │  │  Users  │          │
                                        │  └─────────┘          │
                                        └───────────────────────┘
```

---

## 🔄 Request Flow Diagrams

### Sign Up Flow
```
User fills Signup form
        │
        ▼
POST /user  →  handleUserSignup
        │
        ▼
User.create({ name, email, password })
        │
        ▼
Render login.ejs  (prompt user to log in)
```

### Login Flow
```
User fills Login form
        │
        ▼
POST /user/login  →  handleUserLogin
        │
        ▼
User.findOne({ email, password })
        │
   ┌────┴────┐
   │         │
Not found  Found
   │         │
Render     uuidv4() → sessionId
login.ejs  setUser(sessionId, user)   ← stored in Map
(error)    Set cookie: uid=sessionId
           │
           ▼
       redirect /
```

### Shorten URL Flow
```
User submits URL form (POST /url)
        │
        ▼
restrictToLoggedInUserOnly middleware
   checks cookie → looks up Map → sets req.user
        │
        ▼
handleGenerateNewShortURL
   shortid() → shortID
   URL.create({ shortId, redirectId, visitHistory:[], createdBy: req.user._id })
        │
        ▼
Render home.ejs (shows new short link + full table)
```

### Redirect Flow
```
Browser visits /url/:id
        │
        ▼
handleRedirectToURL
   URL.findOneAndUpdate({ shortId })
   $push visitHistory: { timestamps: Date.now() }
        │
        ▼
res.redirect(result.redirectId)   →   Original URL
```

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js v5 |
| Database | MongoDB (local) |
| ODM | Mongoose v8 |
| View Engine | EJS v6 |
| Session | Cookie + In-memory Map |
| ID Generation | `shortid`, `uuid` |
| Dev Server | Nodemon |

---

## ⚙️ Setup & Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [MongoDB](https://www.mongodb.com/try/download/community) running locally on port `27017`
- npm

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/url-shortener-ejs-auth.git
cd url-shortener-ejs-auth

# 2. Install dependencies
npm install

# 3. Make sure MongoDB is running locally
# Windows: net start MongoDB
# macOS/Linux: mongod --dbpath /data/db

# 4. Start the development server
npm start
# → Server running on PORT 5000
# → MongoDB connected successfully

# 5. Open your browser
open http://localhost:5000
```

> **Note:** The app connects to `mongodb://localhost:27017/short-url` by default. You can change this in `index.js`.

---

## 🌐 API / Route Reference

### Static Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | ✅ Required | Home dashboard — shows all user's links |
| `GET` | `/login` | ❌ | Login page |
| `GET` | `/Signup` | ❌ | Signup page |

### User Routes (`/user`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/user` | ❌ | Create a new account |
| `POST` | `/user/login` | ❌ | Log in, receive session cookie |

### URL Routes (`/url`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/url` | ✅ Required | Shorten a new URL |
| `GET` | `/url/:id` | ❌ | Redirect to original URL + record visit |
| `GET` | `/url/analytics/:id` | ✅ Required | Renders analytics page — total clicks & visit timestamps — **owner only** (403 if not yours) |

---

## 🗃️ Database Schema

### `urls` Collection

```js
{
  shortId:      String,   // Unique short ID (e.g. "Uf3kX9")
  redirectId:   String,   // The original long URL
  visitHistory: [{ timestamps: Number }],  // Unix ms timestamps of each visit
  createdBy:    ObjectId, // Reference to user._id
  createdAt:    Date,     // Auto-managed by Mongoose
  updatedAt:    Date
}
```

### `users` Collection

```js
{
  name:      String,  // Full name
  email:     String,  // Unique email (login credential)
  password:  String,  // Plain text (see improvements below)
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🚧 Known Limitations & Suggested Improvements

| # | Issue | Recommendation |
|---|---|---|
| 1 | **Passwords stored in plain text** | Hash passwords with `bcrypt` before saving |
| 2 | **In-memory session store** | Sessions are lost on server restart. Use `express-session` + `connect-mongo` |
| 3 | **No input sanitization** | Validate URLs and user inputs with `express-validator` |
| 4 | **No logout route** | Add `GET /user/logout` to clear the `uid` cookie |
| 5 | **No HTTPS / env config** | Use `.env` with `dotenv` to externalize secrets and the DB URI |
| 6 | **Analytics has no chart** | Add a visual click-over-time chart (e.g. Chart.js) to the analytics page |
| 7 | **ShortID is deprecated** | Replace `shortid` with `nanoid` (shorter, more collision-safe) |
| 8 | **No custom aliases** | Allow users to choose their own slug (e.g. `/url/my-brand`) |
| 9 | **No link expiry** | Add optional TTL per URL |
| 10 | **No rate limiting** | Add `express-rate-limit` to prevent abuse |

---

## 📄 License

This project is for educational purposes. Feel free to fork and extend it.

---

> Built with Node.js · Express · MongoDB · EJS
