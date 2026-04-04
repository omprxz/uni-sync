# DropRoom — Project Prompt (Text-Only Edition)

> A real-time, room-based **text content sharing** web app built with **Express.js**, **Tailwind CSS**, and **MongoDB**. No login. No file uploads. Just a 6-digit room code and instant sharing.

---

## 🧠 Project Concept

Enter a 6-digit room code → get a shared live space to drop text-based content — snippets, links, notes, code — and instantly access it from any device. Your personal cross-device clipboard, but better.

---

## 🔐 Room System

- **6-digit alphanumeric room codes** (e.g., `X4K9QZ`) — manually entered or auto-generated on home page
- Rooms have a configurable **TTL** — 1h / 6h / 24h / 7 days / never (chosen at creation)
- Option to set a **room password** (bcrypt-hashed) for private rooms
- **Owner mode** — first person to create the room gets a secret token stored in localStorage with extra controls
- **Room expiry countdown** displayed live in the UI
- Rooms can be set to **read-only** by the owner (others can view, not add)
- **Active user count** shown live via WebSocket

---

## 📝 Content Types Supported

| Type | Details |
|---|---|
| **Plain Text** | Any freeform text, notes, thoughts |
| **Links / URLs** | Auto-fetches Open Graph preview (title, description, favicon) |
| **Code Snippets** | Language auto-detection, syntax highlighted |
| **Markdown Notes** | Rendered markdown preview with raw toggle |

---

## ➕ Adding Content

- Simple **input area** at the top of the room — auto-detects type (URL, code, markdown, plain text)
- **Paste from clipboard** anywhere on the page (Ctrl+V / Cmd+V) — instantly creates a new item
- **Keyboard shortcut** — press `N` to focus the new item input
- Character count with soft limit warning (e.g., 10,000 chars max per item)
- Optional **label/title** for each item at the time of adding

---

## 📋 Item Actions

- **Copy to clipboard** — one click, with visual confirmation ("Copied!")
- **Open in new tab** — for links
- **Edit** — inline editing of any item you added
- **Delete** — soft delete with a brief undo toast (5 second grace period)
- **Pin** — owner can pin items to the top of the room
- **Star / Favorite** — saved in localStorage, highlights item for you across sessions
- **Share item link** — direct URL to a single item (no room entry needed)
- **QR code** — generate QR for any item, useful for sending links to mobile instantly

---

## 🖥️ Room UI

- **Card-based layout** — each item is a clean card with type badge, content preview, timestamp, and actions
- **Real-time updates** — new items appear instantly without refresh (Socket.io)
- **Filter bar** — filter by type: All / Text / Links / Code / Markdown
- **Search** — live search across all item content and labels in the room
- **Sort** — newest first / oldest first
- **View modes** — comfortable view (default) and compact/dense view
- **Dark / Light mode** toggle, respects system preference by default
- **Item count** shown in the header

---

## 🔄 Real-Time Features

- **Socket.io** — all changes (add, edit, delete, pin) sync live across all open tabs/devices
- **Presence indicator** — "3 people in this room right now"
- **Activity feed** (subtle, collapsible) — "Someone added a link 2 min ago"
- **"Someone is typing..."** indicator when another user is composing a new item

---

## 🔒 Security

- Room passwords with bcrypt
- **Rate limiting** — per IP on room creation and item submission (express-rate-limit)
- Input **sanitization** to prevent XSS (DOMPurify on client, sanitize-html on server)
- Helmet.js for HTTP security headers
- MongoDB **TTL indexes** for automatic room and item expiry — no manual cleanup needed

---

## 🗄️ MongoDB Collections

- `rooms` — code, password hash, owner token, TTL, settings, created at
- `items` — room ref, type, content, label, pinned, soft-deleted flag, created at, expires at
- `activity` — lightweight log of actions per room (add, edit, delete)

---

## 📱 Mobile & Responsive

- Fully **responsive** — works on all screen sizes out of the box with Tailwind
- **PWA** — installable on home screen (manifest + service worker), no app store needed
- Large tap targets, mobile-friendly input experience
- Bottom sheet style input on small screens

---

## ⚙️ Configuration

- `.env` for all config — MongoDB URI, port, rate limit thresholds, default TTL, max item length
- **Health check** — `GET /health` endpoint
- Clean **REST API** — so you can add items to a room via `curl` or any HTTP client from terminal

---

## 🎨 UI/UX Details

- Smooth **card entrance animations** when new items arrive
- **Toast notifications** for every action (copied, saved, deleted, undo)
- Skeleton loaders while room loads
- **Accessible** — keyboard navigable, ARIA labels, focus management
- Favicon changes color based on room activity (subtle fun detail)

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express.js |
| Database | MongoDB + Mongoose |
| Real-time | Socket.io |
| Frontend | Tailwind CSS + Vanilla JS (EJS templates) |
| Security | bcrypt, Helmet, express-rate-limit, sanitize-html |
| Expiry | MongoDB TTL indexes |

---

*No login. No uploads. No friction. Just drop text and go.*