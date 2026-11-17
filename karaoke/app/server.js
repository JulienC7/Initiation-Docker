// ---------------------------------------------------------------------------
// Karaoke Booking - réservation de places pour des sessions de karaoké
//
// Ce qu'elle fait :
//   - elle affiche une page web (public/index.html) ;
//   - elle se connecte à une base PostgreSQL si on lui dit où la trouver ;
//   - elle liste et enregistre des réservations de salons de karaoké.
// ---------------------------------------------------------------------------

const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { Pool } = require("pg");

// Le port sur lequel l'application écoute. 3000 si on ne précise rien.
const PORT = process.env.PORT || 3000;

// Nombre maximum de places par réservation.
const PLACES_MAX = 12;

// La connexion à la base.
// AUCUN mot de passe ici : la librairie "pg" lit toute seule les variables
// d'environnement PGHOST, PGPORT, PGUSER, PGPASSWORD et PGDATABASE.
// C'est Docker (compose.yaml + .env) qui les fournit.
const pool = new Pool();

let baseConnectee = false;
let dernierMessage = "";

// Évite que l'application plante si la base disparaît en cours de route.
pool.on("error", (err) => {
  console.error("Base : connexion perdue (" + err.message + ")");
  baseConnectee = false;
  setTimeout(connecterLaBase, 2000);
});

// Quelques réservations inventées, ajoutées si la table est vide.
// [salon, jour, créneau, nom, places]
const RESERVATIONS_DE_DEPART = [
  ["Salon Disco", "2026-11-20", "20:00 - 22:00", "Anniversaire de Léa", 8],
  ["Salon Rock", "2026-11-20", "21:00 - 23:00", "Soirée BDE", 12],
  ["Salon Pop", "2026-11-21", "18:00 - 19:30", "Afterwork équipe web", 6],
  ["Salon Disco", "2026-11-22", "22:00 - 00:00", "EVJF Camille", 10],
  ["Salon Jazz", "2026-11-23", "19:00 - 21:00", "Duo Tom & Sarah", 2],
];

// Se connecte à la base, crée la table si besoin et ajoute les données de départ.
// Si la base n'est pas joignable, on réessaie toutes les 2 secondes
// au lieu de planter : l'application reste utilisable sans base.
async function connecterLaBase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id serial PRIMARY KEY,
        salon text NOT NULL,
        jour date NOT NULL,
        creneau text NOT NULL,
        nom text NOT NULL,
        places int NOT NULL CHECK (places BETWEEN 1 AND ${PLACES_MAX}),
        cree_le timestamptz DEFAULT now()
      )
    `);

    const { rows } = await pool.query("SELECT count(*)::int AS total FROM reservations");
    if (rows[0].total === 0) {
      for (const r of RESERVATIONS_DE_DEPART) {
        await pool.query(
          "INSERT INTO reservations (salon, jour, creneau, nom, places) VALUES ($1, $2, $3, $4, $5)",
          r
        );
      }
      console.log("Base : table créée et remplie avec " + RESERVATIONS_DE_DEPART.length + " réservations d'exemple");
    }

    baseConnectee = true;
    console.log("Base : connectée");
  } catch (err) {
    baseConnectee = false;
    // On n'affiche le message que s'il change, pour ne pas inonder les logs.
    const message = "Base : non connectée (" + err.message + "), nouvel essai toutes les 2 s";
    if (message !== dernierMessage) console.log(message);
    dernierMessage = message;
    setTimeout(connecterLaBase, 2000);
  }
}

const app = express();
app.use(express.json());

// La page web.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// L'état de l'application. "conteneur" est le nom de la machine :
// dans Docker, c'est l'identifiant du conteneur.
app.get("/api/sante", (req, res) => {
  res.json({
    api: "ok",
    base: baseConnectee ? "connectée" : "non connectée",
    conteneur: os.hostname(),
  });
});

// La liste des réservations.
app.get("/api/reservations", async (req, res) => {
  if (!baseConnectee) {
    return res.status(503).json({ erreur: "base non connectée" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT id, salon, to_char(jour, 'YYYY-MM-DD') AS jour, creneau, nom, places FROM reservations ORDER BY jour, creneau, id"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Ajouter une réservation.
app.post("/api/reservations", async (req, res) => {
  if (!baseConnectee) {
    return res.status(503).json({ erreur: "base non connectée" });
  }
  const { salon, jour, creneau, nom } = req.body || {};
  const places = Number(req.body?.places);
  if (!salon || !jour || !creneau || !nom) {
    return res.status(400).json({ erreur: "salon, jour, creneau et nom sont obligatoires" });
  }
  if (!Number.isInteger(places) || places < 1 || places > PLACES_MAX) {
    return res.status(400).json({ erreur: "places doit être un entier entre 1 et " + PLACES_MAX });
  }
  try {
    const { rows } = await pool.query(
      "INSERT INTO reservations (salon, jour, creneau, nom, places) VALUES ($1, $2, $3, $4, $5) RETURNING id, salon, to_char(jour, 'YYYY-MM-DD') AS jour, creneau, nom, places",
      [salon, jour, creneau, nom, places]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ erreur: err.message });
  }
});

// On démarre le serveur web tout de suite, puis on tente la base en tâche de fond.
app.listen(PORT, () => {
  console.log("Karaoke : application démarrée sur le port " + PORT);
  connecterLaBase();
});

// Arrêt propre quand Docker demande au conteneur de s'arrêter (docker stop).
process.on("SIGTERM", () => {
  console.log("Karaoke : arrêt demandé, au revoir");
  process.exit(0);
});
