// Karaoke Booking : API pour réserver des places dans les salons de karaoké

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// pg récupère tout seul PGHOST, PGUSER, PGPASSWORD et PGDATABASE (donnés par le compose)
const db = new Pool();

// Création des tables au démarrage (si elles n'existent pas déjà)
async function initBase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS salons (
      nom text PRIMARY KEY,
      capacite int NOT NULL
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id serial PRIMARY KEY,
      salon text NOT NULL REFERENCES salons(nom),
      jour date NOT NULL,
      creneau text NOT NULL,
      nom text NOT NULL,
      places int NOT NULL
    )
  `);
  await db.query(`
    INSERT INTO salons (nom, capacite) VALUES
      ('Salon Disco', 20), ('Salon Rock', 15), ('Salon Pop', 10), ('Salon Jazz', 6)
    ON CONFLICT DO NOTHING
  `);
}

// Places encore libres pour un salon, un jour et un créneau
async function placesLibres(salon, jour, creneau) {
  const result = await db.query(
    `SELECT s.capacite - COALESCE(SUM(r.places), 0) AS libres
     FROM salons s
     LEFT JOIN reservations r ON r.salon = s.nom AND r.jour = $2 AND r.creneau = $3
     WHERE s.nom = $1
     GROUP BY s.capacite`,
    [salon, jour, creneau]
  );
  if (result.rows.length === 0) return null; // salon qui n'existe pas
  return Number(result.rows[0].libres);
}

// Liste des salons
app.get("/api/salons", async (req, res) => {
  const result = await db.query("SELECT * FROM salons ORDER BY nom");
  res.json(result.rows);
});

// Liste des réservations avec les places qui restent sur chaque session
app.get("/api/reservations", async (req, res) => {
  const result = await db.query(`
    SELECT r.id, r.salon, to_char(r.jour, 'DD/MM/YYYY') AS jour, r.creneau, r.nom, r.places,
           s.capacite - SUM(r.places) OVER (PARTITION BY r.salon, r.jour, r.creneau) AS libres
    FROM reservations r
    JOIN salons s ON s.nom = r.salon
    ORDER BY r.jour, r.creneau
  `);
  res.json(result.rows);
});

// Nouvelle réservation
app.post("/api/reservations", async (req, res) => {
  const { salon, jour, creneau, nom } = req.body;
  const places = parseInt(req.body.places);

  if (!salon || !jour || !creneau || !nom || !places || places < 1) {
    return res.status(400).json({ erreur: "Il manque des informations" });
  }

  const libres = await placesLibres(salon, jour, creneau);
  if (libres === null) {
    return res.status(400).json({ erreur: "Ce salon n'existe pas" });
  }
  if (places > libres) {
    return res.status(400).json({ erreur: "Pas assez de places, il en reste " + libres });
  }

  await db.query(
    "INSERT INTO reservations (salon, jour, creneau, nom, places) VALUES ($1, $2, $3, $4, $5)",
    [salon, jour, creneau, nom, places]
  );
  res.status(201).json({ message: "Réservation enregistrée" });
});

// Annuler une réservation
app.delete("/api/reservations/:id", async (req, res) => {
  const result = await db.query("DELETE FROM reservations WHERE id = $1", [req.params.id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ erreur: "Réservation introuvable" });
  }
  res.json({ message: "Réservation annulée" });
});

// On prépare la base puis on lance le serveur
initBase()
  .then(() => {
    app.listen(3000, () => console.log("Karaoke Booking lancé sur le port 3000"));
  })
  .catch((err) => {
    console.error("Impossible de se connecter à la base :", err.message);
    process.exit(1);
  });
