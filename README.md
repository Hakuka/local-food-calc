Yes, this is AI slop, im a tester and lazy programmer. But it allows me to save some $ so deal with it.

# Home Diet — Local Application for 2 users

It does not require a ChatGPT account or cloud services. Data is stored in a local SQLite file, created automatically on the first launch.

## Requirement

Requires **Node.js 22.13 or later**

## Start

```
npm ci
npm run build
npm start
```

Open **http://localhost:3000**. For subsequent launches, run `npm start`.

## Two Users on a Home Network

Start a single instance of the application on a computer or home server. Both users access the same instance and select either the Janusz or Grażyna profile.

In PowerShell on the computer that will act as the server:

```powershell
$env:HOST = '0.0.0.0'
npm start
```

On a phone or another computer, open `http://SERVER_IP_ADDRESS:3000`, for example `http://192.168.0.131:3000` if that is your server's current address. If the connection is blocked, allow TCP port 3000 through the firewall for private networks.

Profiles are selected within the application; they are not separate password-protected accounts. With this setup, any device that can connect to the server on your home network can access the application.

## Data Storage

On the first launch, the application creates the `data/` folder and the **`data/dieta.sqlite`** file. SQLite runs in WAL mode; the `dieta.sqlite-wal` and `dieta.sqlite-shm` files may also exist while the application is running.

New databases import the products, dated diary entries, daily notes, and both profiles with their default targets from `lib/seed.json`. The seed contains no undated spreadsheet entries.

Initialization runs only once. Subsequent launches preserve your data, and changes to the seed do not clear an existing database. The `data/` folder and SQLite files are excluded from Git. Do not delete the `data` folder if you want to keep your history.

New diary entries default to the selected day; editing keeps the saved date, including an empty field. A date is required when saving.

In the **Products (Produkty)** tab, the **Add Item (Dodaj pozycję)** button opens a form with a **Product / Dish (Produkt / Danie)** toggle, set to product by default. A name is required; the product manufacturer is optional. For a dish, select products from the searchable list, enter each ingredient's weight in grams, and specify the **total weight of the finished dish**. The preview automatically shows nutritional values per 100 g. Ingredients and weight are saved with the dish and can be edited later. Saving the dish again recalculates its values using the current product data. A saved dish can be selected in the diary just like a product.

Search covers the name, manufacturer, and note. Archiving a product requires confirmation and preserves your food history. Older databases automatically receive the manufacturer column and recipe fields on startup.

The **Planner (Planer)** tab stores a separate meal plan for each profile. It opens the remaining weeks of the current month starting on the current Monday (Warsaw time), ending on the Sunday of the week containing the last day of that month. A week/month toggle, month/week navigation, and a shortcut back to the current week are available. Add products or dishes with weights, or free-text notes such as “Zamawiamy pizzę”. Add several products, dishes, or free-text items in one form (for example, a complete dinner) and save them together. Selected foods appear as compact rows with their weight on the right. One shared meal note belongs to each profile, date, and meal category (for example, breakfast), regardless of how many foods it contains. Adding more foods preserves that note. Click the note in the calendar to edit or clear it. Existing food annotations migrate automatically into shared meal notes without losing text. Shared meal notes are included in JSON backups and remain independent between profiles. Each day shows its date, then the add button, then planned items. The date field beside the Planner title displays the visible range and opens a calendar for choosing a day; the range is not repeated below. Buttons below the calendar generate a shopping list for each visible Monday–Sunday week or one combined list for the entire visible range, for the selected profile. Repeated products are summed in grams. Dish portions are expanded into ingredients using current catalog recipes and finished weights. Free-text items and meal notes appear separately from weighted products. Shopping lists do not change stored plans or diary totals. The optional “Dodaj również drugiej osobie” switch creates independent copies in both profiles in one database transaction; subsequent edits or deletions affect only the selected profile. Nutritional previews always show the selected profile only. Click a planned item to edit or delete it. Planner dialogs close only using their buttons; clicking outside or pressing Escape leaves them open. The calendar shows only planned items and weights; the editor shows the saved daily nutritional totals, the selected portion, and the total after saving. Plans never contribute to diary totals, reports, or the results CSV. Product values are captured when planning; changing a planned portion scales its saved values. The calendar button in Products adds the selected item to a plan, defaulting to next Monday. Plans are persisted in SQLite and included in JSON backups. Existing databases receive the planner table automatically.

You can set a different data folder:

```powershell
$env:DATA_DIR = 'C:\dieta\data'
npm start
```

You can change the port using the `PORT` environment variable; the default is 3000.

## Backup and Restore

- In the application: **Profiles and Data → Download Data Backup (JSON)** (**Profile i dane → Pobierz kopię danych (JSON)**). The backup includes both profiles, products, meal plans, notes, and history. Automatic JSON import is not yet available.
- Full SQLite backup: stop the application, copy the entire `data` folder to another location, such as a NAS, and restart the application. Stopping it ensures a consistent backup.
- SQLite restore: stop the application, keep a backup of the current `data` folder, replace it with the backup folder you want to restore, and start the application.

## Editing the Code and Development Mode

Frontend: React + TypeScript + Vite. Backend: Node.js and its built-in `node:sqlite` module, with no additional server dependencies.

```powershell
npm install
npm run dev
```

Development interface: **http://localhost:5173**. Backend and data: port 3000. The script starts both processes; pressing Ctrl+C stops both.

After making changes, rebuild the production interface:

```powershell
npm run build
npm start
```

Checks:

```powershell
npm run typecheck
npm test
```

Tests use temporary databases and do not modify the `data` folder.

## Key Files

| File | Purpose |
| --- | --- |
| `app/diet-app.tsx` | Views, forms, and profile switching |
| `app/globals.css` | Styling and responsive layout |
| `lib/calculations.ts` | Totals, portions, and date handling |
| `lib/seed.json` | Imported spreadsheet data and default profiles for first-launch initialization |
| `server/storage.mjs` | SQLite, validation, persistence, and concurrent edit detection |
| `server/index.mjs` | Local HTTP server and API |
| `dist/` | Production interface generated by `npm run build` (excluded from Git) |
| `tests/local.test.mjs` | Persistence, history, and API tests |
