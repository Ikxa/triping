# 🌷 Amsterdam Trip Planner

App collaborative pour organiser votre voyage à Amsterdam (22-24 juin 2026).
Hébergée sur GitHub Pages, partagée entre amis en temps quasi-réel.

---

## 🚀 Déploiement GitHub Pages

```bash
git init && git add . && git commit -m "🌷 Amsterdam trip planner"
git remote add origin https://github.com/TON_PSEUDO/triping.git
git push -u origin main
# GitHub → Settings → Pages → Branch: main → Save
```

---

## 📦 Activer le partage entre amis (JSONBin — 2 min)

Sans config, chaque personne a ses données en local (localStorage).
Pour un board partagé entre tous les amis :

### 1. Crée un bin sur JSONBin.io
1. Va sur [jsonbin.io](https://jsonbin.io) → Create Account (gratuit)
2. Clique **"+ Create Bin"** → contenu : `[]` → **Create**
3. Copie le **Bin ID** dans l'URL (ex: `663f2ab3acd6cb34a843...`)

### 2. Récupère ta Master Key
→ Menu gauche : **API Keys** → **Master Key** → Copy

### 3. Colle dans `config.js`
```js
export const JSONBIN_BIN_ID  = '663f2ab3acd6cb34a843...';
export const JSONBIN_API_KEY = '$2b$10$abc...';
```

### 4. Push sur GitHub → tous vos amis partagent les données !

> JSONBin gratuit = 10 000 requêtes/mois, largement suffisant pour un voyage.
> L'app rafraîchit toutes les 45 secondes + bouton ↻ manuel en haut.

---

## 🖼️ Activer l'upload de photos (ImgBB — 30 secondes)

Sans config, les photos uploadées sont compressées en base64 local.
Pour héberger les photos dans le cloud (CDN permanent) :

1. Va sur [api.imgbb.com](https://api.imgbb.com) → connecte-toi
2. Copie ta clé API → colle dans `config.js` :

```js
export const IMGBB_API_KEY = 'abc123def456...';
```

---

## 🗓️ Modifier la date du voyage

Dans `config.js` (pré-configuré sur le 22 juin 2026) :
```js
export const TRIP_DATE = '2026-06-22';
```

---

## ✨ Fonctionnalités

| Feature | Description |
|---------|-------------|
| 📌 CRUD | Ajouter / modifier / supprimer des lieux |
| ❤️ Votes | Chaque ami peut voter pour ses préférés |
| 📊 Statuts | À faire → Visité → Skip (clic sur le badge) |
| 🔍 Recherche | Full-text sur tous les champs |
| 🗂️ Filtres | Par catégorie (8) + statut (3) |
| 🔃 Tri | Récent, populaire, A→Z, budget |
| 🖼️ Photos | Upload fichier (ImgBB cloud) ou URL |
| 🗺️ Maps | Lien Google Maps + mini-map en vue détail |
| 🌡️ Météo | Température live à Amsterdam |
| ✈️ Countdown | Jours avant le départ |
| ↻ Refresh | Auto toutes les 45s + bouton manuel |

---

## 🛠️ Dev local

```bash
python3 -m http.server 8080  # ou: npx serve .
```
> ⚠️ Nécessite un serveur HTTP (pas `file://`) — ES modules.

---

## 📁 Structure

```
triping/
├── index.html    → Structure HTML
├── style.css     → Design paperboard premium
├── app.js        → Logique + JSONBin + ImgBB
├── config.js     → ⚙️ À personnaliser
└── README.md     → Ce fichier
```
